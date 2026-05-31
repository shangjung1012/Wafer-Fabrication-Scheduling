set -eu

CONFIG_FILE="/tmp/prometheus.yml"
: "${MONITOR_HTTP_TARGETS:?MONITOR_HTTP_TARGETS is required}"
: "${POSTGRES_EXPORTER_TARGET:?POSTGRES_EXPORTER_TARGET is required}"
: "${REDIS_EXPORTER_TARGET:?REDIS_EXPORTER_TARGET is required}"
: "${BLACKBOX_EXPORTER_TARGET:?BLACKBOX_EXPORTER_TARGET is required}"

cat > "$CONFIG_FILE" <<EOF
global:
  scrape_interval: ${MONITOR_SCRAPE_INTERVAL:-15s}
  evaluation_interval: ${MONITOR_EVALUATION_INTERVAL:-15s}

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets:
          - localhost:9090

  - job_name: postgres
    static_configs:
      - targets:
          - ${POSTGRES_EXPORTER_TARGET}

  - job_name: redis
    static_configs:
      - targets:
          - ${REDIS_EXPORTER_TARGET}

  - job_name: app_pages
    metrics_path: /probe
    params:
      module:
        - http_2xx
    static_configs:
      - targets:
EOF

OLD_IFS="$IFS"
IFS=","
for target in $MONITOR_HTTP_TARGETS; do
  trimmed="$(printf '%s' "$target" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -n "$trimmed" ]; then
    printf '          - "%s"\n' "$trimmed" >> "$CONFIG_FILE"
  fi
done
IFS="$OLD_IFS"

cat >> "$CONFIG_FILE" <<EOF
    relabel_configs:
      - source_labels:
          - __address__
        target_label: __param_target
      - source_labels:
          - __param_target
        target_label: instance
      - target_label: __address__
        replacement: ${BLACKBOX_EXPORTER_TARGET}
EOF

exec /bin/prometheus \
  --config.file="$CONFIG_FILE" \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time="${PROMETHEUS_RETENTION:-15d}" \
  --web.external-url="${PROMETHEUS_EXTERNAL_URL:-http://localhost:9090}" \
  --web.console.libraries=/usr/share/prometheus/console_libraries \
  --web.console.templates=/usr/share/prometheus/consoles
