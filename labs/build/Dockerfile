ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS builder
RUN printf 'artifact=hello-docker\n' > /message.txt \
    && printf 'belongs to builder only\n' > /build-only.txt

FROM ${BASE_IMAGE}
COPY --from=builder /message.txt /message.txt
