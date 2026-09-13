package pl.ksef.sidecar.service;

import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.MGF1ParameterSpec;
import java.util.Base64;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class EncryptionService {

    /**
     * Encrypts token|timestampMs using RSA-OAEP with SHA-256 hash and MGF1 with SHA-256.
     * CRITICAL: MGF1 must use SHA-256, NOT the Java default of SHA-1.
     */
    public String encryptForSession(String token, String timestamp, String publicKeyPem) throws Exception {
        PublicKey publicKey = parsePublicKey(publicKeyPem);

        long timestampMs = java.time.Instant.parse(timestamp).toEpochMilli();
        String plaintext = token + "|" + timestampMs;

        // RSA-OAEP with SHA-256 for both hash and MGF1 (NOT default SHA-1 for MGF1)
        OAEPParameterSpec oaepParams = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,  // CRITICAL: SHA-256, not SHA-1
                PSource.PSpecified.DEFAULT
        );

        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey, oaepParams);
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        return Base64.getEncoder().encodeToString(encrypted);
    }

    /**
     * Encrypts invoice XMLs into an AES-256-CBC encrypted ZIP with RSA-OAEP key wrapping.
     * Returns: encryptedZip (base64), encryptedAesKey (base64), iv (base64), invoiceHashes
     */
    public Map<String, Object> encryptBatchPackage(List<String> invoiceXmls, String publicKeyPem) throws Exception {
        PublicKey publicKey = parsePublicKey(publicKeyPem);

        // Generate random AES-256 key
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        SecretKey aesKey = keyGen.generateKey();

        // Generate random 16-byte IV
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);

        // Create ZIP of invoice XMLs and compute SHA-256 hashes
        ByteArrayOutputStream zipBaos = new ByteArrayOutputStream();
        List<Map<String, Object>> invoiceHashes = new ArrayList<>();

        try (ZipOutputStream zos = new ZipOutputStream(zipBaos)) {
            for (int i = 0; i < invoiceXmls.size(); i++) {
                byte[] xmlBytes = invoiceXmls.get(i).getBytes(StandardCharsets.UTF_8);

                // SHA-256 hash of the invoice
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] hash = digest.digest(xmlBytes);
                String hashHex = bytesToHex(hash);

                Map<String, Object> hashEntry = new HashMap<>();
                hashEntry.put("index", i);
                hashEntry.put("sha256", hashHex);
                invoiceHashes.add(hashEntry);

                // Add to ZIP
                ZipEntry entry = new ZipEntry("invoice_" + i + ".xml");
                zos.putNextEntry(entry);
                zos.write(xmlBytes);
                zos.closeEntry();
            }
        }

        byte[] zipBytes = zipBaos.toByteArray();

        // AES-256-CBC encrypt the ZIP (IV prepended to ciphertext)
        Cipher aesCipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        aesCipher.init(Cipher.ENCRYPT_MODE, aesKey, new IvParameterSpec(iv));
        byte[] encryptedZip = aesCipher.doFinal(zipBytes);

        // RSA-OAEP encrypt the AES key (SHA-256 hash + MGF1 SHA-256)
        OAEPParameterSpec oaepParams = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );
        Cipher rsaCipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        rsaCipher.init(Cipher.ENCRYPT_MODE, publicKey, oaepParams);
        byte[] encryptedAesKey = rsaCipher.doFinal(aesKey.getEncoded());

        Map<String, Object> result = new HashMap<>();
        result.put("encryptedZipBase64", Base64.getEncoder().encodeToString(encryptedZip));
        result.put("aesKeyEncryptedBase64", Base64.getEncoder().encodeToString(encryptedAesKey));
        result.put("ivBase64", Base64.getEncoder().encodeToString(iv));
        result.put("invoiceHashes", invoiceHashes);
        result.put("success", true);

        return result;
    }

    /**
     * KSeF's GET /security/public-key-certificates returns a full X.509
     * certificate (DER, Base64) in its "certificate" field, not a bare
     * SubjectPublicKeyInfo - confirmed 2026-09-13 against the real test API
     * (api-test.ksef.mf.gov.pl): the returned bytes parse with `openssl
     * x509` into a real certificate with subject "Ministerstwo Finansów"
     * and a real CA issuer chain. Every caller in this codebase
     * (ksef-client.ts's getPublicKeyCertificate()) passes that value
     * straight through as ksefPublicKeyPem, so this always receives a
     * certificate, never a bare key - the previous implementation, which
     * fed the raw bytes into X509EncodedKeySpec (only valid for a bare
     * SubjectPublicKeyInfo, a different and smaller ASN.1 structure nested
     * inside a certificate), would throw on every real call. Confirmed
     * broken, not just theoretically: a full KSeF certificate is ~1.6KB;
     * the SubjectPublicKeyInfo X509EncodedKeySpec expects is ~294 bytes.
     */
    private PublicKey parsePublicKey(String certificateOrPemBase64) throws Exception {
        String cleaned = certificateOrPemBase64
                .replace("-----BEGIN CERTIFICATE-----", "")
                .replace("-----END CERTIFICATE-----", "")
                .replaceAll("\\s+", "");
        byte[] certBytes = Base64.getDecoder().decode(cleaned);
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        X509Certificate cert = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(certBytes));
        return cert.getPublicKey();
    }

    /**
     * Generates a random AES-256 key + 16-byte IV for a KSeF 2.0 online
     * session, and RSA-OAEP-SHA256-encrypts the key for the certificate
     * whose usage is SymmetricKeyEncryption (a different cert than the
     * KsefTokenEncryption one used for the auth flow - see
     * getPublicKeyCertificate(usage) in ksef-client.ts). Per the vendored
     * spec (ksef-openapi.json: EncryptionInfo, OpenOnlineSessionRequest,
     * SendInvoiceRequest), the SAME key+IV pair is reused for every invoice
     * sent within that session - SendInvoiceRequest carries no per-invoice
     * IV field, so the caller must hold onto keyBase64/ivBase64 for the
     * session's lifetime and pass them to encryptInvoiceForSession() for
     * each invoice.
     */
    public Map<String, Object> generateSessionKey(String publicKeyPem) throws Exception {
        PublicKey publicKey = parsePublicKey(publicKeyPem);

        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        SecretKey aesKey = keyGen.generateKey();

        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);

        OAEPParameterSpec oaepParams = new OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT
        );
        Cipher rsaCipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        rsaCipher.init(Cipher.ENCRYPT_MODE, publicKey, oaepParams);
        byte[] encryptedKey = rsaCipher.doFinal(aesKey.getEncoded());

        Map<String, Object> result = new HashMap<>();
        result.put("keyBase64", Base64.getEncoder().encodeToString(aesKey.getEncoded()));
        result.put("ivBase64", Base64.getEncoder().encodeToString(iv));
        result.put("encryptedKeyBase64", Base64.getEncoder().encodeToString(encryptedKey));
        result.put("success", true);
        return result;
    }

    /**
     * Encrypts a single invoice XML for KSeF 2.0's online session ("wysyłka
     * interaktywna") flow: POST /sessions/online/{referenceNumber}/invoices.
     * Per the vendored spec's SendInvoiceRequest.encryptedInvoiceContent
     * description: "Faktura zaszyfrowana algorytmem AES-256-CBC z
     * dopełnianiem PKCS#7" - AES-256-CBC with PKCS#7 padding, using the key
     * established when the session was opened (generateSessionKey above).
     * This is NOT AES-256-GCM - this codebase's earlier notes (CLAUDE.md,
     * HANDOVER.md, FIXES-2026-09-13.md) all assumed GCM, but the vendored
     * ksef-openapi.json contains zero occurrences of "GCM" anywhere; both
     * the online-session and batch-session flows use CBC+PKCS7, differing
     * only in chunking and which endpoint opens the session.
     */
    public Map<String, Object> encryptInvoiceForSession(String invoiceXml, String keyBase64, String ivBase64) throws Exception {
        byte[] plaintext = invoiceXml.getBytes(StandardCharsets.UTF_8);
        byte[] keyBytes = Base64.getDecoder().decode(keyBase64);
        byte[] iv = Base64.getDecoder().decode(ivBase64);

        SecretKey aesKey = new SecretKeySpec(keyBytes, "AES");
        Cipher aesCipher = Cipher.getInstance("AES/CBC/PKCS5Padding"); // PKCS5Padding == PKCS7 for a 16-byte block cipher
        aesCipher.init(Cipher.ENCRYPT_MODE, aesKey, new IvParameterSpec(iv));
        byte[] ciphertext = aesCipher.doFinal(plaintext);

        byte[] plainHash = MessageDigest.getInstance("SHA-256").digest(plaintext);
        byte[] cipherHash = MessageDigest.getInstance("SHA-256").digest(ciphertext);

        Map<String, Object> result = new HashMap<>();
        result.put("invoiceHash", Base64.getEncoder().encodeToString(plainHash));
        result.put("invoiceSize", plaintext.length);
        result.put("encryptedInvoiceHash", Base64.getEncoder().encodeToString(cipherHash));
        result.put("encryptedInvoiceSize", ciphertext.length);
        result.put("encryptedInvoiceContent", Base64.getEncoder().encodeToString(ciphertext));
        result.put("success", true);
        return result;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
