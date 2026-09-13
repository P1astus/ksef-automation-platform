package pl.ksef.sidecar.model;

public record EncryptTokenRequest(
    String token,
    String timestamp,
    String ksefPublicKeyPem
) {}
