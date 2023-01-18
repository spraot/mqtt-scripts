FROM node as jsbuilder

COPY . /app
WORKDIR /app

RUN npm install

# ---------------------------------------------------------

FROM node:slim

COPY --from=jsbuilder /app /app
RUN mkdir /logs

WORKDIR /app

EXPOSE 3001
ENTRYPOINT [ "node", "index.js" ]
