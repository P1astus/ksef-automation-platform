package pl.ksef.sidecar.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Round 4: every endpoint on this sidecar (/encrypt-for-session,
 * /encrypt-batch-package, /generate-session-key, /encrypt-invoice) was
 * reachable by anyone who could reach port 8090 - no authentication at all,
 * published on 0.0.0.0. Same class of exposure as the already-deleted
 * /sign-challenge endpoint, but these four are actually used, so deletion
 * wasn't an option here. Requires a shared secret header instead.
 *
 * Fails fast at startup if SIDECAR_API_KEY is unset, rather than silently
 * running with the door open - same convention as auth.ts's
 * MissingJwtSecretError and db.ts's DATABASE_URL check on the portal side.
 * /actuator/** stays open: docker-compose healthchecks and INSTALL.md's
 * `curl localhost:8090/actuator/health` don't carry the key.
 */
@Component
public class SidecarApiKeyFilter extends OncePerRequestFilter {

    private static final String HEADER_NAME = "X-Sidecar-Api-Key";

    private final byte[] expectedApiKeyBytes;

    public SidecarApiKeyFilter(@Value("${sidecar.api-key:}") String expectedApiKey) {
        if (expectedApiKey == null || expectedApiKey.isBlank()) {
            throw new IllegalStateException(
                    "SIDECAR_API_KEY is not set. Refusing to start: without it, every crypto " +
                    "endpoint on this sidecar would be reachable by anyone who can reach port " +
                    "8090, unauthenticated.");
        }
        this.expectedApiKeyBytes = expectedApiKey.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/actuator")) {
            chain.doFilter(request, response);
            return;
        }

        String provided = request.getHeader(HEADER_NAME);
        if (provided == null || !constantTimeEquals(provided)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"success\":false,\"error\":\"Unauthorized\"}");
            return;
        }

        chain.doFilter(request, response);
    }

    private boolean constantTimeEquals(String provided) {
        return MessageDigest.isEqual(provided.getBytes(StandardCharsets.UTF_8), expectedApiKeyBytes);
    }
}
