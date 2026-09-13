package pl.ksef.sidecar.controller;

import pl.ksef.sidecar.model.BatchEncryptRequest;
import pl.ksef.sidecar.model.ChallengeSignRequest;
import pl.ksef.sidecar.model.EncryptTokenRequest;
import pl.ksef.sidecar.service.ChallengeSigningService;
import pl.ksef.sidecar.service.EncryptionService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class CryptoController {

    private final ChallengeSigningService challengeSigningService;
    private final EncryptionService encryptionService;

    public CryptoController(ChallengeSigningService challengeSigningService,
                            EncryptionService encryptionService) {
        this.challengeSigningService = challengeSigningService;
        this.encryptionService = encryptionService;
    }

    @PostMapping("/sign-challenge")
    public ResponseEntity<Map<String, Object>> signChallenge(@RequestBody ChallengeSignRequest request) {
        try {
            String signedChallenge = challengeSigningService.signChallenge(
                    request.challenge(),
                    request.timestamp(),
                    request.certificatePath(),
                    request.certificatePassword(),
                    request.nip()
            );
            return ResponseEntity.ok(Map.of(
                    "signedChallenge", signedChallenge,
                    "success", true
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "error", e.getMessage()
            ));
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
}
