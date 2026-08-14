FROM docker.io/cloudflare/sandbox:0.12.5

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable xvfb x11vnc novnc websockify fluxbox \
  && npm install -g @jackwener/opencli@1.8.6 \
  && rm -rf /var/lib/apt/lists/* /root/.npm

COPY container/opencli-session.sh /usr/local/bin/opencli-session
RUN chmod 0755 /usr/local/bin/opencli-session

EXPOSE 6080
