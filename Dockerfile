FROM node:18.6-alpine as jsbuilder
RUN apk update && apk add make g++ python2
WORKDIR /app
COPY config.js index.js package-lock.json package.json ./
COPY sandbox/ sandbox/
RUN LDFLAGS="-static-libgcc -static-libstdc++" npm install --build-from-source=sqlite3

FROM astefanutti/scratch-node

COPY --from=jsbuilder /app /
WORKDIR /
ENTRYPOINT [ "node", "index.js" ]
