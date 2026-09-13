package pl.ksef.sidecar;

import org.apache.xml.security.Init;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import jakarta.annotation.PostConstruct;

@SpringBootApplication
public class KsefSidecarApplication {

    @PostConstruct
    public void initXmlSecurity() {
        Init.init();
    }

    public static void main(String[] args) {
        SpringApplication.run(KsefSidecarApplication.class, args);
    }
}
