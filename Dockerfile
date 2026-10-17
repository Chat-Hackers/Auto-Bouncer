FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json bouncer.mjs server.mjs operations.mjs handler.mjs storage.mjs registration.mjs ./
COPY --chown=node:node public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=5059 DATA_DIR=/data
EXPOSE 5059
CMD ["npm","start"]
