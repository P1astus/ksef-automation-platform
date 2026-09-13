package pl.ksef.sidecar.model;

import java.util.List;

public record BatchEncryptRequest(
    List<String> invoiceXmls,
    String ksefPublicKeyPem
) {}
