FROM node:26-alpine
ARG TARGETPLATFORM

# Copy across the files from our `intermediate` container
RUN mkdir app

COPY ../src /app/src

COPY ../locales /app/locales

COPY ../package*.json /app

WORKDIR /app

RUN mkdir data

# Use the npm bundled with the base image: "npm install -g npm@latest" broke the build once npm 12
# dropped support for odd-numbered Node lines (node 25 ships npm 11, which is all npm ci needs).
RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then npm ci --omit=dev ; else \
    apk --no-cache --update --virtual build-dependencies add \
    build-base python3 \
    && npm ci --omit=dev \
    && apk del build-dependencies ; fi \
    && rm package-lock.json

ENTRYPOINT [ "node", "src/index.js" ]
CMD []