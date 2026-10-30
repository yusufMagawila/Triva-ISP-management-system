FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends freeradius freeradius-postgresql freeradius-utils python3 procps ca-certificates && rm -rf /var/lib/apt/lists/*
COPY sql.conf /etc/freeradius/3.0/mods-available/triva_sql
COPY site.conf /etc/freeradius/3.0/sites-available/triva
RUN rm /etc/freeradius/3.0/sites-enabled/default && ln -s ../sites-available/triva /etc/freeradius/3.0/sites-enabled/triva && ln -s ../mods-available/triva_sql /etc/freeradius/3.0/mods-enabled/triva_sql
RUN install -d -o freerad -g freerad /var/log/freeradius/radacct
COPY entrypoint.py /opt/triva/entrypoint.py
ENTRYPOINT ["python3", "/opt/triva/entrypoint.py"]
