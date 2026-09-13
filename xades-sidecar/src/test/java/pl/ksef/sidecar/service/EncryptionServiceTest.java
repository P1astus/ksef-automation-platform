package pl.ksef.sidecar.service;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.cert.X509v3CertificateBuilder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.junit.jupiter.api.Test;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.security.spec.MGF1ParameterSpec;
import java.util.Base64;
import java.util.Date;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * D8: EncryptionService is used to (a) fix a confirmed pre-existing bug in
 * parsePublicKey() - KSeF's /security/public-key-certificates returns a
 * full X.509 certificate, not a bare public key, and the old implementation
 * could never have parsed a real one - and (b) add the AES-256-CBC/PKCS7
 * primitives the KSeF 2.0 online-session invoice flow actually needs (the
 * vendored ksef-openapi.json spec has zero occurrences of "GCM" anywhere;
 * this codebase's earlier notes assuming GCM were never checked against it).
 *
 * These are unit tests against a self-signed certificate built with
 * BouncyCastle at test time (already a runtime dependency) - no live network
 * call and no real KSeF certificate material involved.
 */
class EncryptionServiceTest {

    static {
        Security.addProvider(new BouncyCastleProvider());
    }

    private static X509Certificate selfSignedCertWrapping(KeyPair keyPair) throws Exception {
        X500Name subject = new X500Name("CN=Test KSeF Cert");
        ContentSigner signer = new JcaContentSignerBuilder("SHA256withRSA").build(keyPair.getPrivate());
        X509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
                subject,
                BigInteger.valueOf(1),
                new Date(System.currentTimeMillis() - 86_400_000L),
                new Date(System.currentTimeMillis() + 86_400_000L),
                subject,
                keyPair.getPublic()
        );
        return new JcaX509CertificateConverter().getCertificate(builder.build(signer));
    }

    private static KeyPair generateRsaKeyPair() throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        return kpg.generateKeyPair();
    }

    // Fails before the fix: X509EncodedKeySpec cannot parse a full
    // certificate's outer ASN.1 structure (~1.6KB, with issuer/validity/
    // signature) - only the ~294-byte SubjectPublicKeyInfo nested inside
    // one. Every real KSeF API response is a full certificate (confirmed
    // 2026-09-13 against api-test.ksef.mf.gov.pl), so the old code would
    // have thrown on every real call.
    @Test
    void encryptForSession_acceptsARealX509CertificateLikeKsefActuallyReturns() throws Exception {
        KeyPair keyPair = generateRsaKeyPair();
        X509Certificate cert = selfSignedCertWrapping(keyPair);
        String certBase64 = Base64.getEncoder().encodeToString(cert.getEncoded());

        EncryptionService service = new EncryptionService();
        String encrypted = service.encryptForSession("abc123", java.time.Instant.now().toString(), certBase64);

        byte[] ciphertext = Base64.getDecoder().decode(encrypted);
        OAEPParameterSpec oaepParams = new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        cipher.init(Cipher.DECRYPT_MODE, keyPair.getPrivate(), oaepParams);
        byte[] plaintext = cipher.doFinal(ciphertext);

        assertThat(new String(plaintext, StandardCharsets.UTF_8)).startsWith("abc123|");
    }

    @Test
    void generateSessionKey_producesAKeyThatDecryptsCorrectlyWithTheMatchingPrivateKey() throws Exception {
        KeyPair keyPair = generateRsaKeyPair();
        X509Certificate cert = selfSignedCertWrapping(keyPair);
        String certBase64 = Base64.getEncoder().encodeToString(cert.getEncoded());

        EncryptionService service = new EncryptionService();
        Map<String, Object> result = service.generateSessionKey(certBase64);

        byte[] encryptedKey = Base64.getDecoder().decode((String) result.get("encryptedKeyBase64"));
        OAEPParameterSpec oaepParams = new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT);
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        cipher.init(Cipher.DECRYPT_MODE, keyPair.getPrivate(), oaepParams);
        byte[] decryptedKey = cipher.doFinal(encryptedKey);

        assertThat(Base64.getEncoder().encodeToString(decryptedKey)).isEqualTo(result.get("keyBase64"));
        assertThat(decryptedKey).hasSize(32); // AES-256
        assertThat(Base64.getDecoder().decode((String) result.get("ivBase64"))).hasSize(16);
    }

    @Test
    void generateSessionKey_usesADistinctRandomKeyAndIvEachCall() throws Exception {
        KeyPair keyPair = generateRsaKeyPair();
        String certBase64 = Base64.getEncoder().encodeToString(selfSignedCertWrapping(keyPair).getEncoded());
        EncryptionService service = new EncryptionService();

        Map<String, Object> first = service.generateSessionKey(certBase64);
        Map<String, Object> second = service.generateSessionKey(certBase64);

        assertThat(first.get("keyBase64")).isNotEqualTo(second.get("keyBase64"));
        assertThat(first.get("ivBase64")).isNotEqualTo(second.get("ivBase64"));
    }

    @Test
    void encryptInvoiceForSession_roundTripsWithAesCbcPkcs7UsingTheSessionKey() throws Exception {
        EncryptionService service = new EncryptionService();

        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        SecretKey aesKey = keyGen.generateKey();
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        String keyBase64 = Base64.getEncoder().encodeToString(aesKey.getEncoded());
        String ivBase64 = Base64.getEncoder().encodeToString(iv);
        String xml = "<Faktura><Numer>FV/1/2026</Numer></Faktura>";

        Map<String, Object> result = service.encryptInvoiceForSession(xml, keyBase64, ivBase64);

        // Round-trip: decrypting with the exact same key/IV recovers the XML
        Cipher decryptCipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        decryptCipher.init(Cipher.DECRYPT_MODE, aesKey, new IvParameterSpec(iv));
        byte[] decrypted = decryptCipher.doFinal(Base64.getDecoder().decode((String) result.get("encryptedInvoiceContent")));
        assertThat(new String(decrypted, StandardCharsets.UTF_8)).isEqualTo(xml);

        // Matches KSeF's SendInvoiceRequest schema: invoiceHash/invoiceSize
        // describe the plaintext, encryptedInvoiceHash/encryptedInvoiceSize
        // the ciphertext - proves they aren't swapped or both-plaintext.
        byte[] plainBytes = xml.getBytes(StandardCharsets.UTF_8);
        byte[] cipherBytes = Base64.getDecoder().decode((String) result.get("encryptedInvoiceContent"));
        assertThat(result.get("invoiceHash")).isEqualTo(
                Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(plainBytes)));
        assertThat(result.get("invoiceSize")).isEqualTo(plainBytes.length);
        assertThat(result.get("encryptedInvoiceHash")).isEqualTo(
                Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(cipherBytes)));
        assertThat(result.get("encryptedInvoiceSize")).isEqualTo(cipherBytes.length);
        assertThat(result.get("invoiceHash")).isNotEqualTo(result.get("encryptedInvoiceHash"));
    }

    @Test
    void encryptInvoiceForSession_reusingTheSameKeyAndIvAcrossInvoicesMatchesTheSpecContract() throws Exception {
        // SendInvoiceRequest has no per-invoice IV field - the spec requires
        // reusing the session's key+IV for every invoice sent within it.
        // Same plaintext + same key + same IV must reproduce the exact same
        // ciphertext (deterministic CBC), proving the method doesn't
        // silently generate a fresh IV per call, which would break this.
        EncryptionService service = new EncryptionService();
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        String keyBase64 = Base64.getEncoder().encodeToString(keyGen.generateKey().getEncoded());
        String ivBase64 = Base64.getEncoder().encodeToString(new byte[16]);
        String xml = "<Faktura/>";

        Map<String, Object> first = service.encryptInvoiceForSession(xml, keyBase64, ivBase64);
        Map<String, Object> second = service.encryptInvoiceForSession(xml, keyBase64, ivBase64);

        assertThat(first.get("encryptedInvoiceContent")).isEqualTo(second.get("encryptedInvoiceContent"));
    }
}
