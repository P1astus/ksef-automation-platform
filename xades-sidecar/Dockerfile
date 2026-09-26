FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# Runs unprivileged; the mounted certificates only need to be readable.
RUN groupadd --system --gid 10001 sidecar \
    && useradd --system --uid 10001 --gid sidecar --no-create-home --shell /usr/sbin/nologin sidecar \
    && mkdir -p /app/certificates \
    && chown -R sidecar:sidecar /app
USER sidecar
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "app.jar"]
