FROM node:18.6-alpine as jsbuilder
RUN apk update && apk add make g++ python2
WORKDIR /app
COPY . ./
COPY sandbox/ sandbox/
RUN LDFLAGS="-static-libgcc -static-libstdc++" npm install --build-from-source=sqlite3

RUN cd sandbox \
    LDFLAGS="-static-libgcc -static-libstdc++" npm install --build-from-source=sqlite3

FROM astefanutti/scratch-node

COPY --from=jsbuilder /app /
WORKDIR /
EXPOSE 3000
ENTRYPOINT [ "node", "index.js" ]
