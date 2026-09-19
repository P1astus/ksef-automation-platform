package pl.ksef.sidecar.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import javax.xml.XMLConstants;
import javax.xml.crypto.dom.DOMStructure;
import javax.xml.crypto.dsig.CanonicalizationMethod;
import javax.xml.crypto.dsig.DigestMethod;
import javax.xml.crypto.dsig.Reference;
import javax.xml.crypto.dsig.SignatureMethod;
import javax.xml.crypto.dsig.SignedInfo;
import javax.xml.crypto.dsig.Transform;
import javax.xml.crypto.dsig.XMLObject;
import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMSignContext;
import javax.xml.crypto.dsig.keyinfo.KeyInfo;
import javax.xml.crypto.dsig.keyinfo.KeyInfoFactory;
import javax.xml.crypto.dsig.keyinfo.X509Data;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.crypto.dsig.spec.TransformParameterSpec;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.Transformer;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * XAdES-BES signing (enveloped) of an XML document, as the Ministry of Finance
 * JPK gateway requires for the InitUpload metadata (spec "Interfejsy usług
 * JPK" 1.3.1): RSA-SHA256, and exactly two references in SignedInfo - the whole
 * document and the SignedProperties element - or the file is rejected.
 *
 * The signing key is configured on the server (a PKCS#12 file named by
 * JPK_SIGNING_KEYSTORE_PATH) and is NEVER taken from a request: an earlier
 * endpoint that accepted a certificate path and password in the request body
 * was deleted for exactly that reason (round 3). Unconfigured = signing is
 * unavailable, not silently faked.
 */
@Service
public class XadesSigningService {

    public static final String XADES_NS = "http://uri.etsi.org/01903/v1.3.2#";
    public static final String SIGNED_PROPERTIES_TYPE = "http://uri.etsi.org/01903#SignedProperties";
    private static final String DSIG_NS = XMLSignature.XMLNS;

    private final PrivateKey privateKey;
    private final X509Certificate certificate;

    @Autowired
    public XadesSigningService(
            @Value("${sidecar.jpk-signing.keystore-path:}") String keystorePath,
            @Value("${sidecar.jpk-signing.keystore-password:}") String keystorePassword) {
        if (keystorePath == null || keystorePath.isBlank()) {
            this.privateKey = null;
            this.certificate = null;
            return;
        }
        // A configured-but-broken keystore stops the service from starting:
        // better than discovering it when a taxpayer's filing is due.
        try (FileInputStream in = new FileInputStream(keystorePath)) {
            KeyStore ks = KeyStore.getInstance("PKCS12");
            char[] pw = keystorePassword == null ? new char[0] : keystorePassword.toCharArray();
            ks.load(in, pw);
            String alias = null;
            for (var e = ks.aliases(); e.hasMoreElements(); ) {
                String a = e.nextElement();
                if (ks.isKeyEntry(a)) { alias = a; break; }
            }
            if (alias == null) throw new IllegalStateException("no private-key entry in " + keystorePath);
            this.privateKey = (PrivateKey) ks.getKey(alias, pw);
            this.certificate = (X509Certificate) ks.getCertificate(alias);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot load JPK signing keystore " + keystorePath + ": " + e.getMessage(), e);
        }
    }

    /** For tests: sign with an explicit key/certificate. */
    public XadesSigningService(PrivateKey privateKey, X509Certificate certificate) {
        this.privateKey = privateKey;
        this.certificate = certificate;
    }

    public boolean isConfigured() {
        return privateKey != null && certificate != null;
    }

    public X509Certificate getCertificate() {
        return certificate;
    }

    public String signEnveloped(String xml) throws Exception {
        if (!isConfigured()) throw new IllegalStateException("JPK signing key is not configured (JPK_SIGNING_KEYSTORE_PATH)");

        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        // Untrusted input: no DTDs / external entities.
        dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        dbf.setXIncludeAware(false);
        dbf.setExpandEntityReferences(false);
        Document doc = dbf.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));

        String suffix = UUID.randomUUID().toString();
        String signatureId = "Signature-" + suffix;
        String signedPropsId = "SignedProperties-" + suffix;

        Element qualifying = buildQualifyingProperties(doc, signatureId, signedPropsId);
        Element signedProps = (Element) qualifying.getElementsByTagNameNS(XADES_NS, "SignedProperties").item(0);

        XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");
        DigestMethod sha256 = fac.newDigestMethod(DigestMethod.SHA256, null);
        Transform enveloped = fac.newTransform(Transform.ENVELOPED, (TransformParameterSpec) null);
        Transform c14n = fac.newTransform(CanonicalizationMethod.INCLUSIVE, (TransformParameterSpec) null);

        // Reference 1: the whole document. Reference 2: SignedProperties.
        Reference docRef = fac.newReference("", sha256, List.of(enveloped, c14n), null, null);
        Reference propsRef = fac.newReference("#" + signedPropsId, sha256, List.of(c14n), SIGNED_PROPERTIES_TYPE, null);
        SignedInfo signedInfo = fac.newSignedInfo(
                fac.newCanonicalizationMethod(CanonicalizationMethod.INCLUSIVE, (C14NMethodParameterSpec) null),
                fac.newSignatureMethod(SignatureMethod.RSA_SHA256, null),
                List.of(docRef, propsRef));

        KeyInfoFactory kif = fac.getKeyInfoFactory();
        X509Data x509 = kif.newX509Data(Collections.singletonList(certificate));
        KeyInfo keyInfo = kif.newKeyInfo(Collections.singletonList(x509));

        XMLObject object = fac.newXMLObject(Collections.singletonList(new DOMStructure(qualifying)), null, null, null);
        XMLSignature signature = fac.newXMLSignature(signedInfo, keyInfo, Collections.singletonList(object), signatureId, null);

        DOMSignContext ctx = new DOMSignContext(privateKey, doc.getDocumentElement());
        ctx.putNamespacePrefix(XMLSignature.XMLNS, "ds");
        ctx.setIdAttributeNS(signedProps, null, "Id");
        signature.sign(ctx);

        return serialize(doc);
    }

    private Element buildQualifyingProperties(Document doc, String signatureId, String signedPropsId) throws Exception {
        Element qp = doc.createElementNS(XADES_NS, "xades:QualifyingProperties");
        qp.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:xades", XADES_NS);
        qp.setAttribute("Target", "#" + signatureId);

        Element sp = doc.createElementNS(XADES_NS, "xades:SignedProperties");
        sp.setAttribute("Id", signedPropsId);
        Element ssp = doc.createElementNS(XADES_NS, "xades:SignedSignatureProperties");

        Element time = doc.createElementNS(XADES_NS, "xades:SigningTime");
        time.setTextContent(Instant.now().truncatedTo(ChronoUnit.SECONDS).toString());
        ssp.appendChild(time);

        Element sc = doc.createElementNS(XADES_NS, "xades:SigningCertificate");
        Element cert = doc.createElementNS(XADES_NS, "xades:Cert");
        Element certDigest = doc.createElementNS(XADES_NS, "xades:CertDigest");
        Element dm = doc.createElementNS(DSIG_NS, "ds:DigestMethod");
        dm.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:ds", DSIG_NS);
        dm.setAttribute("Algorithm", DigestMethod.SHA256);
        Element dv = doc.createElementNS(DSIG_NS, "ds:DigestValue");
        dv.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:ds", DSIG_NS);
        dv.setTextContent(Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())));
        certDigest.appendChild(dm);
        certDigest.appendChild(dv);
        Element issuerSerial = doc.createElementNS(XADES_NS, "xades:IssuerSerial");
        Element issuerName = doc.createElementNS(DSIG_NS, "ds:X509IssuerName");
        issuerName.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:ds", DSIG_NS);
        issuerName.setTextContent(certificate.getIssuerX500Principal().getName());
        Element serial = doc.createElementNS(DSIG_NS, "ds:X509SerialNumber");
        serial.setAttributeNS(XMLConstants.XMLNS_ATTRIBUTE_NS_URI, "xmlns:ds", DSIG_NS);
        serial.setTextContent(certificate.getSerialNumber().toString());
        issuerSerial.appendChild(issuerName);
        issuerSerial.appendChild(serial);
        cert.appendChild(certDigest);
        cert.appendChild(issuerSerial);
        sc.appendChild(cert);
        ssp.appendChild(sc);

        sp.appendChild(ssp);
        qp.appendChild(sp);
        return qp;
    }

    private static String serialize(Document doc) throws Exception {
        Transformer t = TransformerFactory.newInstance().newTransformer();
        t.setOutputProperty(OutputKeys.ENCODING, "UTF-8");
        t.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
        StringWriter w = new StringWriter();
        t.transform(new DOMSource(doc), new StreamResult(w));
        return w.toString();
    }
}
