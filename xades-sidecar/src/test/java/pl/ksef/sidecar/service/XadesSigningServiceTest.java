package pl.ksef.sidecar.service;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.crypto.dsig.XMLSignature;
import javax.xml.crypto.dsig.XMLSignatureFactory;
import javax.xml.crypto.dsig.dom.DOMValidateContext;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * XAdES-BES for the MF JPK gateway's InitUpload metadata. The gateway rejects
 * a signature that lacks EITHER of two references (the whole document and the
 * SignedProperties), so those are asserted structurally, and the signature is
 * verified with an independent JSR-105 validation - including that tampering
 * breaks it. (The real verdict is the ministry's gateway; see
 * portal/src/lib/jpk-gateway.live.test.ts.)
 */
class XadesSigningServiceTest {

    private static final String DOC =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<InitUpload xmlns=\"http://e-dokumenty.mf.gov.pl\"><DocumentType>JPK</DocumentType>"
            + "<Version>01.02.01.20160617</Version></InitUpload>";

    private static KeyPair keyPair;
    private static X509Certificate cert;

    @BeforeAll
    static void setUp() throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048, new SecureRandom());
        keyPair = kpg.generateKeyPair();
        X500Name name = new X500Name("CN=JPK Test Signer,SERIALNUMBER=VATPL-1010000000,C=PL");
        ContentSigner signer = new JcaContentSignerBuilder("SHA256withRSA").build(keyPair.getPrivate());
        cert = new JcaX509CertificateConverter().getCertificate(new JcaX509v3CertificateBuilder(
                name, BigInteger.valueOf(System.currentTimeMillis()),
                new Date(System.currentTimeMillis() - 60_000), new Date(System.currentTimeMillis() + 86_400_000L),
                name, keyPair.getPublic()).build(signer));
    }

    private static Document parse(String xml) throws Exception {
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        return dbf.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean validate(String signedXml) throws Exception {
        Document doc = parse(signedXml);
        NodeList sigs = doc.getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
        DOMValidateContext ctx = new DOMValidateContext(cert.getPublicKey(), sigs.item(0));
        NodeList props = doc.getElementsByTagNameNS(XadesSigningService.XADES_NS, "SignedProperties");
        ctx.setIdAttributeNS((Element) props.item(0), null, "Id");
        return XMLSignatureFactory.getInstance("DOM").unmarshalXMLSignature(ctx).validate(ctx);
    }

    @Test
    void signsEnvelopedWithExactlyTheTwoRequiredReferencesAndValidates() throws Exception {
        String signed = new XadesSigningService(keyPair.getPrivate(), cert).signEnveloped(DOC);
        Document doc = parse(signed);

        NodeList refs = doc.getElementsByTagNameNS(XMLSignature.XMLNS, "Reference");
        assertThat(refs.getLength()).isEqualTo(2);
        Element whole = (Element) refs.item(0);
        Element props = (Element) refs.item(1);
        assertThat(whole.getAttribute("URI")).isEmpty();
        assertThat(props.getAttribute("Type")).isEqualTo(XadesSigningService.SIGNED_PROPERTIES_TYPE);
        String signedPropsId = ((Element) doc.getElementsByTagNameNS(XadesSigningService.XADES_NS, "SignedProperties").item(0)).getAttribute("Id");
        assertThat(props.getAttribute("URI")).isEqualTo("#" + signedPropsId);

        // Enveloped: the Signature is a child of the original root, appended last.
        Element root = doc.getDocumentElement();
        assertThat(root.getLocalName()).isEqualTo("InitUpload");
        assertThat(((Element) root.getLastChild()).getLocalName()).isEqualTo("Signature");

        // RSA-SHA256 signature and digests, certificate carried in KeyInfo.
        assertThat(signed).contains("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
        assertThat(signed).contains("http://www.w3.org/2001/04/xmlenc#sha256");
        assertThat(doc.getElementsByTagNameNS(XMLSignature.XMLNS, "X509Certificate").getLength()).isEqualTo(1);
        assertThat(doc.getElementsByTagNameNS(XadesSigningService.XADES_NS, "SigningTime").getLength()).isEqualTo(1);

        assertThat(validate(signed)).isTrue();
    }

    @Test
    void tamperingWithTheDocumentOrTheSignedPropertiesInvalidatesTheSignature() throws Exception {
        String signed = new XadesSigningService(keyPair.getPrivate(), cert).signEnveloped(DOC);
        assertThat(validate(signed.replace("<DocumentType>JPK</DocumentType>", "<DocumentType>JPKAH</DocumentType>"))).isFalse();
        assertThat(validate(signed.replaceFirst("<xades:SigningTime>[^<]+<", "<xades:SigningTime>2001-01-01T00:00:00Z<"))).isFalse();
    }

    @Test
    void rejectsDtdInput() {
        XadesSigningService svc = new XadesSigningService(keyPair.getPrivate(), cert);
        String xxe = "<?xml version=\"1.0\"?><!DOCTYPE a [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><a>&x;</a>";
        assertThatThrownBy(() -> svc.signEnveloped(xxe)).isInstanceOf(org.xml.sax.SAXException.class);
    }

    @Test
    void unconfiguredServiceRefusesInsteadOfProducingAnUnsignedDocument() {
        XadesSigningService svc = new XadesSigningService("", "");
        assertThat(svc.isConfigured()).isFalse();
        assertThatThrownBy(() -> svc.signEnveloped(DOC)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void loadsTheSigningKeyFromAPkcs12File(@TempDir Path dir) throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry("jpk", keyPair.getPrivate(), "pw".toCharArray(), new java.security.cert.Certificate[]{cert});
        Path file = dir.resolve("jpk.p12");
        try (FileOutputStream out = new FileOutputStream(file.toFile())) { ks.store(out, "pw".toCharArray()); }

        XadesSigningService svc = new XadesSigningService(file.toString(), "pw");
        assertThat(svc.isConfigured()).isTrue();
        assertThat(validate(svc.signEnveloped(DOC))).isTrue();
    }

    @Test
    void aConfiguredButUnreadableKeystoreStopsStartupInsteadOfFailingLater(@TempDir Path dir) {
        assertThatThrownBy(() -> new XadesSigningService(dir.resolve("missing.p12").toString(), "pw"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Cannot load JPK signing keystore");
    }

    /**
     * The bean has a second, test-only constructor, so Spring needs @Autowired
     * on the real one - a startup failure the plain unit tests above cannot see
     * (it crash-looped the container the first time this was deployed).
     */
    @Test
    void springCreatesTheBeanFromConfigurationProperties(@TempDir Path dir) throws Exception {
        try (var ctx = new org.springframework.context.annotation.AnnotationConfigApplicationContext()) {
            ctx.register(XadesSigningService.class);
            ctx.getEnvironment().getPropertySources().addFirst(
                    new org.springframework.core.env.MapPropertySource("t", java.util.Map.of()));
            ctx.refresh();
            assertThat(ctx.getBean(XadesSigningService.class).isConfigured()).isFalse();
        }

        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry("jpk", keyPair.getPrivate(), "pw".toCharArray(), new java.security.cert.Certificate[]{cert});
        Path file = dir.resolve("spring.p12");
        try (FileOutputStream out = new FileOutputStream(file.toFile())) { ks.store(out, "pw".toCharArray()); }
        try (var ctx = new org.springframework.context.annotation.AnnotationConfigApplicationContext()) {
            ctx.getEnvironment().getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("t", java.util.Map.of(
                    "sidecar.jpk-signing.keystore-path", file.toString(),
                    "sidecar.jpk-signing.keystore-password", "pw")));
            ctx.register(XadesSigningService.class);
            ctx.refresh();
            assertThat(ctx.getBean(XadesSigningService.class).isConfigured()).isTrue();
        }
    }
}
