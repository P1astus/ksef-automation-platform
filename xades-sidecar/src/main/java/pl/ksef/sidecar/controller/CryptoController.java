package pl.ksef.sidecar.controller;

import pl.ksef.sidecar.model.BatchEncryptRequest;
import pl.ksef.sidecar.model.EncryptInvoiceRequest;
import pl.ksef.sidecar.model.EncryptTokenRequest;
import pl.ksef.sidecar.model.GenerateSessionKeyRequest;
import pl.ksef.sidecar.service.EncryptionService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class CryptoController {

    private final EncryptionService encryptionService;

    public CryptoController(EncryptionService encryptionService) {
        this.encryptionService = encryptionService;
    }

    @PostMapping("/encrypt-for-session")
    public ResponseEntity<Map<String, Object>> encryptForSession(@RequestBody EncryptTokenRequest request) {
        try {
            String encryptedToken = encryptionService.encryptForSession(
                    request.token(),
                    request.timestamp(),
                    request.ksefPublicKeyPem()
            );
            return ResponseEntity.ok(Map.of(
                    "encryptedToken", encryptedToken,
                    "success", true
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
        }
    }

    @PostMapping("/encrypt-batch-package")
    public ResponseEntity<Map<String, Object>> encryptBatchPackage(@RequestBody BatchEncryptRequest request) {
        try {
            Map<String, Object> result = encryptionService.encryptBatchPackage(
                    request.invoiceXmls(),
                    request.ksefPublicKeyPem()
            );
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
        }
    }

    /**
     * D8: generates the AES-256 key + IV for a KSeF 2.0 online session,
     * RSA-OAEP-SHA256-encrypted for the SymmetricKeyEncryption certificate.
     * Called once per session (POST /sessions/online) - see ksef-client.ts's
     * openOnlineSession().
     */
    @PostMapping("/generate-session-key")
    public ResponseEntity<Map<String, Object>> generateSessionKey(@RequestBody GenerateSessionKeyRequest request) {
        try {
            Map<String, Object> result = encryptionService.generateSessionKey(request.ksefPublicKeyPem());
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
        }
    }

    /**
     * D8: encrypts one invoice XML with AES-256-CBC/PKCS7 using a session's
     * already-established key+IV. Called once per invoice within an open
     * online session - see ksef-client.ts's encryptInvoiceForSession().
     */
    @PostMapping("/encrypt-invoice")
    public ResponseEntity<Map<String, Object>> encryptInvoice(@RequestBody EncryptInvoiceRequest request) {
        try {
            Map<String, Object> result = encryptionService.encryptInvoiceForSession(
                    request.invoiceXml(),
                    request.keyBase64(),
                    request.ivBase64()
            );
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
        }
    }
}
