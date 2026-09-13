package pl.ksef.sidecar.model;

public record GenerateSessionKeyRequest(
    String ksefPublicKeyPem
) {}
