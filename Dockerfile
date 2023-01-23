FROM node:18.6-bullseye-slim as builder

RUN apt-get update && apt-get -y upgrade

WORKDIR /app
COPY package*.json ./
COPY sandbox/package*.json sandbox/
RUN npm ci --prod

FROM astefanutti/scratch-node

COPY --from=builder /app /
WORKDIR /
COPY . ./
EXPOSE 3001
ENTRYPOINT [ "node", "index.js" ]
