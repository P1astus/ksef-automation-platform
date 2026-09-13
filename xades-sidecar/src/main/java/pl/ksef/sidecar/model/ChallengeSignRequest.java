package pl.ksef.sidecar.model;

public record ChallengeSignRequest(
    String challenge,
    String timestamp,
    String certificatePath,
    String certificatePassword,
    String nip
) {}
