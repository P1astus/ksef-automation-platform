package pl.ksef.sidecar.service;

import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
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

    private PublicKey parsePublicKey(String pem) throws Exception {
        String cleaned = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s+", "");
        byte[] keyBytes = Base64.getDecoder().decode(cleaned);
        X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        return kf.generatePublic(spec);
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
