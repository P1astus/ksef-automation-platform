package pl.ksef.sidecar.controller;

import pl.ksef.sidecar.model.BatchEncryptRequest;
import pl.ksef.sidecar.model.EncryptInvoiceRequest;
import pl.ksef.sidecar.model.EncryptTokenRequest;
import pl.ksef.sidecar.model.GenerateSessionKeyRequest;
import pl.ksef.sidecar.model.SignXmlRequest;
import pl.ksef.sidecar.service.XadesSigningService;
import pl.ksef.sidecar.service.EncryptionService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class CryptoController {

    private final EncryptionService encryptionService;
    private final XadesSigningService xadesSigningService;

    public CryptoController(EncryptionService encryptionService, XadesSigningService xadesSigningService) {
        this.encryptionService = encryptionService;
        this.xadesSigningService = xadesSigningService;
    }

    /**
     * XAdES-BES (enveloped, RSA-SHA256) signature over an XML document, for the
     * MF JPK gateway's InitUpload metadata. The signing key comes from server
     * configuration only (JPK_SIGNING_KEYSTORE_PATH) - never from the request.
     * 503 when no key is configured, so a missing key can't be mistaken for a
     * signed document.
     */
    @PostMapping("/sign-xades-bes")
    public ResponseEntity<Map<String, Object>> signXadesBes(@RequestBody SignXmlRequest request) {
        if (!xadesSigningService.isConfigured()) {
            return ResponseEntity.status(503).body(Map.of(
                    "success", false,
                    "error", "JPK signing key is not configured on the sidecar"
            ));
        }
        if (request == null || request.xml() == null || request.xml().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "xml is required"));
        }
        try {
            return ResponseEntity.ok(Map.of("success", true, "signedXml", xadesSigningService.signEnveloped(request.xml())));
        } catch (org.xml.sax.SAXException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "xml is not well-formed or contains a DTD"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("success", false, "error", e.getMessage()));
        }
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
