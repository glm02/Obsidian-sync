# Serveur Cordée : Node 22 suffit, aucune dépendance à installer.
FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
COPY server/src ./src
RUN mkdir -p /donnees && chown node:node /donnees
ENV CORDEE_DONNEES=/donnees CORDEE_PORT=8787 NODE_ENV=production
VOLUME /donnees
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
