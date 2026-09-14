package pl.ksef.sidecar.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

import java.io.PrintWriter;
import java.io.StringWriter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Round 4: this sidecar's four crypto endpoints had zero authentication and
 * are published on 0.0.0.0:8090 - anyone who could reach the port could call
 * them. Proves the fix: a missing key refuses to start at all (fail fast,
 * same convention as the portal's MissingJwtSecretError), a wrong or absent
 * header is rejected, a correct one passes through, and /actuator/** stays
 * open for the health checks docker-compose and INSTALL.md already rely on.
 */
class SidecarApiKeyFilterTest {

    @Test
    void refusesToConstructWithoutAnApiKey() {
        assertThatThrownBy(() -> new SidecarApiKeyFilter(""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SIDECAR_API_KEY is not set");

        assertThatThrownBy(() -> new SidecarApiKeyFilter(null))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectsARequestWithNoApiKeyHeader() throws Exception {
        SidecarApiKeyFilter filter = new SidecarApiKeyFilter("correct-key");
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getRequestURI()).thenReturn("/encrypt-for-session");
        when(request.getHeader("X-Sidecar-Api-Key")).thenReturn(null);
        StringWriter body = new StringWriter();
        when(response.getWriter()).thenReturn(new PrintWriter(body));

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void rejectsARequestWithTheWrongApiKey() throws Exception {
        SidecarApiKeyFilter filter = new SidecarApiKeyFilter("correct-key");
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getRequestURI()).thenReturn("/generate-session-key");
        when(request.getHeader("X-Sidecar-Api-Key")).thenReturn("wrong-key");
        StringWriter body = new StringWriter();
        when(response.getWriter()).thenReturn(new PrintWriter(body));

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
    }

    @Test
    void allowsARequestWithTheCorrectApiKey() throws Exception {
        SidecarApiKeyFilter filter = new SidecarApiKeyFilter("correct-key");
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getRequestURI()).thenReturn("/encrypt-invoice");
        when(request.getHeader("X-Sidecar-Api-Key")).thenReturn("correct-key");

        filter.doFilter(request, response, chain);

        verify(chain, times(1)).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    }

    @Test
    void allowsActuatorHealthWithoutAnyApiKeyHeader() throws Exception {
        SidecarApiKeyFilter filter = new SidecarApiKeyFilter("correct-key");
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getRequestURI()).thenReturn("/actuator/health");
        when(request.getHeader("X-Sidecar-Api-Key")).thenReturn(null);

        filter.doFilter(request, response, chain);

        verify(chain, times(1)).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    }

    @Test
    void rejectsAnEmptyHeaderValueTheSameAsAMissingOne() throws Exception {
        SidecarApiKeyFilter filter = new SidecarApiKeyFilter("correct-key");
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getRequestURI()).thenReturn("/encrypt-for-session");
        when(request.getHeader("X-Sidecar-Api-Key")).thenReturn("");
        StringWriter body = new StringWriter();
        when(response.getWriter()).thenReturn(new PrintWriter(body));

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(request, response);
    }
}
