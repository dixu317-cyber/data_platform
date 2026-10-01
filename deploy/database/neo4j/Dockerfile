FROM neo4j:5.26.28-community

# Reuse the exact APOC Core tuple already verified by M2-A while keeping the
# image name and every data resource independent from M2-A.
RUN echo "399826fa8ac759c5f94121b91f00c13c86aecff628172d336c4e8171c5f499ef  /var/lib/neo4j/labs/apoc-5.26.28-core.jar" \
      | sha256sum -c - \
    && cp /var/lib/neo4j/labs/apoc-5.26.28-core.jar /var/lib/neo4j/plugins/apoc-5.26.28-core.jar

COPY healthcheck.sh /opt/ff/healthcheck.sh
RUN chmod 0555 /opt/ff/healthcheck.sh
