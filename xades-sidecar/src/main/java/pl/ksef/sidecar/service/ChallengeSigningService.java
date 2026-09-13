package pl.ksef.sidecar.service;

import org.apache.xml.security.algorithms.MessageDigestAlgorithm;
import org.apache.xml.security.c14n.Canonicalizer;
import org.apache.xml.security.signature.XMLSignature;
import org.apache.xml.security.transforms.Transforms;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.Enumeration;
import java.util.UUID;

@Service
public class ChallengeSigningService {

    private static final String XADES_NS = "http://uri.etsi.org/01903/v1.3.2#";
    private static final String DS_NS = "http://www.w3.org/2000/09/xmldsig#";
    private static final String AUTH_NS = "http://ksef.mf.gov.pl/auth/token/2.0";

    public String signChallenge(String challenge, String timestamp,
                                 String certificatePath, String certificatePassword,
                                 String nip) throws Exception {
        org.apache.xml.security.Init.init();

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (FileInputStream fis = new FileInputStream(certificatePath)) {
            keyStore.load(fis, certificatePassword.toCharArray());
        }

        String alias = null;
        Enumeration<String> aliases = keyStore.aliases();
        while (aliases.hasMoreElements()) {
            String a = aliases.nextElement();
            if (keyStore.isKeyEntry(a)) { alias = a; break; }
        }
        if (alias == null) throw new IllegalStateException("No private key found in certificate");

        PrivateKey privateKey = (PrivateKey) keyStore.getKey(alias, certificatePassword.toCharArray());
        X509Certificate cert = (X509Certificate) keyStore.getCertificate(alias);

        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        Document doc = dbf.newDocumentBuilder().newDocument();

        Element root = doc.createElementNS(AUTH_NS, "AuthTokenRequest");
        // CRITICAL: Explicitly set xmlns attribute so C14N includes it in digest computation
        root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", AUTH_NS);
        root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xsi",
                "http://www.w3.org/2001/XMLSchema-instance");
        doc.appendChild(root);

        Element challengeEl = doc.createElementNS(AUTH_NS, "Challenge");
        challengeEl.setTextContent(challenge);
        root.appendChild(challengeEl);

        Element contextId = doc.createElementNS(AUTH_NS, "ContextIdentifier");
        root.appendChild(contextId);
        Element nipEl = doc.createElementNS(AUTH_NS, "Nip");
        nipEl.setTextContent(nip != null ? nip : "1111111111");
        contextId.appendChild(nipEl);

        Element subjectType = doc.createElementNS(AUTH_NS, "SubjectIdentifierType");
        subjectType.setTextContent("certificateSubject");
        root.appendChild(subjectType);

        String signatureId = "ID-" + UUID.randomUUID().toString();
        String signedInfoId = "ID-" + UUID.randomUUID().toString();
        String signedPropsId = "ID-" + UUID.randomUUID().toString();
        String qualifyingPropsId = "ID-" + UUID.randomUUID().toString();
        String docRefId = "ID-" + UUID.randomUUID().toString();
        String propsRefId = "ID-" + UUID.randomUUID().toString();

        XMLSignature sig = new XMLSignature(doc, "",
                XMLSignature.ALGO_ID_SIGNATURE_RSA_SHA256,
                Canonicalizer.ALGO_ID_C14N_OMIT_COMMENTS);
        sig.setId(signatureId);
        sig.getSignedInfo().setId(signedInfoId);
        root.appendChild(sig.getElement());

        // XAdES-BES QualifyingProperties
        Element qualifyingProps = doc.createElementNS(XADES_NS, "xades:QualifyingProperties");
        // CRITICAL: Explicitly declare xmlns:xades so C14N includes it in serialized output
        qualifyingProps.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xades", XADES_NS);
        qualifyingProps.setAttributeNS(null, "Id", qualifyingPropsId);
        qualifyingProps.setAttribute("Target", "#" + signatureId);

        Element signedProps = doc.createElementNS(XADES_NS, "xades:SignedProperties");
        signedProps.setAttributeNS(null, "Id", signedPropsId);
        signedProps.setIdAttributeNS(null, "Id", true);

        Element signedSigProps = doc.createElementNS(XADES_NS, "xades:SignedSignatureProperties");

        Element signingTime = doc.createElementNS(XADES_NS, "xades:SigningTime");
        signingTime.setTextContent(Instant.now().atOffset(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'")));
        signedSigProps.appendChild(signingTime);

        Element signingCert = doc.createElementNS(XADES_NS, "xades:SigningCertificate");
        Element certEl = doc.createElementNS(XADES_NS, "xades:Cert");

        Element certDigest = doc.createElementNS(XADES_NS, "xades:CertDigest");
        Element digestMethod = doc.createElementNS(DS_NS, "ds:DigestMethod");
        digestMethod.setAttribute("Algorithm", MessageDigestAlgorithm.ALGO_ID_DIGEST_SHA256);
        certDigest.appendChild(digestMethod);

        Element digestValue = doc.createElementNS(DS_NS, "ds:DigestValue");
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        byte[] certHash = sha256.digest(cert.getEncoded());
        digestValue.setTextContent(Base64.getEncoder().encodeToString(certHash));
        certDigest.appendChild(digestValue);
        certEl.appendChild(certDigest);

        Element issuerSerial = doc.createElementNS(XADES_NS, "xades:IssuerSerial");
        Element issuerName = doc.createElementNS(DS_NS, "ds:X509IssuerName");
        issuerName.setTextContent(cert.getIssuerX500Principal().getName(
                javax.security.auth.x500.X500Principal.RFC2253));
        issuerSerial.appendChild(issuerName);
        Element serialNumber = doc.createElementNS(DS_NS, "ds:X509SerialNumber");
        serialNumber.setTextContent(cert.getSerialNumber().toString());
        issuerSerial.appendChild(serialNumber);
        certEl.appendChild(issuerSerial);

        signingCert.appendChild(certEl);
        signedSigProps.appendChild(signingCert);
        signedProps.appendChild(signedSigProps);
        qualifyingProps.appendChild(signedProps);

        Element dsObject = doc.createElementNS(DS_NS, "ds:Object");
        dsObject.appendChild(qualifyingProps);
        sig.getElement().appendChild(dsObject);

        // Document reference - only enveloped-signature transform
        Transforms transforms = new Transforms(doc);
        transforms.addTransform(Transforms.TRANSFORM_ENVELOPED_SIGNATURE);
        sig.addDocument("", transforms, MessageDigestAlgorithm.ALGO_ID_DIGEST_SHA256,
                docRefId, null);

        // SignedProperties reference - no transforms
        sig.addDocument("#" + signedPropsId, null,
                MessageDigestAlgorithm.ALGO_ID_DIGEST_SHA256,
                propsRefId, "http://uri.etsi.org/01903#SignedProperties");

        sig.addKeyInfo(cert);
        sig.sign(privateKey);

        // Serialize using C14N for byte-perfect roundtrip (now with explicit xmlns)
        Canonicalizer c14n = Canonicalizer.getInstance(Canonicalizer.ALGO_ID_C14N_OMIT_COMMENTS);
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        c14n.canonicalizeSubtree(doc, baos);

        return Base64.getEncoder().encodeToString(baos.toByteArray());
    }
}
