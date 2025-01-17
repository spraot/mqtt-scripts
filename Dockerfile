FROM node:22-bullseye-slim

RUN apt-get update && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY sandbox/package*.json sandbox/
RUN npm ci --prod

COPY . ./
EXPOSE 3001
ENTRYPOINT [ "node", "index.js" ]
