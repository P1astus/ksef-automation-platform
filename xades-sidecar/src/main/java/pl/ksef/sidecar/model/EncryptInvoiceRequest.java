package pl.ksef.sidecar.model;

public record EncryptInvoiceRequest(
    String invoiceXml,
    String keyBase64,
    String ivBase64
) {}
