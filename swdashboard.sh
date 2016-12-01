#!/bin/bash

mkdir -p /data/swdashboard/code /data/swdashboard/log
touch /data/swdashboard/state.json
cd /data/swdashboard/code

git clone -q https://github.com/mitselek/ScreenWerk-Dashboard.git ./
git checkout -q master
git pull

printf "\n\n"
version=`date +"%y%m%d.%H%M%S"`
docker build --quiet --pull --tag=swdashboard:$version ./ && docker tag swdashboard:$version swdashboard:latest

printf "\n\n"
docker stop swdashboard
docker rm swdashboard
docker run -d \
    --net="entu" \
    --name="swdashboard" \
    --restart="always" \
    --cpu-shares=256 \
    --memory="250m" \
    --env="NODE_ENV=production" \
    --env="VERSION=$version" \
    --env="PORT=80" \
    --env="HOST=swdashboard.entu.eu" \
    --env="COOKIE_SECRET=" \
    --env="DEPLOYMENT=debug" \
    --env="NEW_RELIC_APP_NAME=swdashboard" \
    --env="NEW_RELIC_LICENSE_KEY=" \
    --env="NEW_RELIC_LOG=stdout" \
    --env="NEW_RELIC_LOG_LEVEL=error" \
    --env="NEW_RELIC_NO_CONFIG_FILE=true" \
    --env="GOOGLE_TIMEZONE_API_KEY=" \
    --env="GOOGLE_MAPS_API_KEY=" \
    --env="NGINX_LOG=access.log" \
    --env="PUBLISHER_LOG=publisher.log" \
    --env="ENTU_KEY=" \
    --env="SENTRY_DSN=" \
    --volume="/data/swdashboard/state.json:/usr/src/swdashboard/state.json" \
    --volume="/data/swpublisher/screens:/usr/src/swdashboard/screens:ro" \
    --volume="/data/swpublisher/log/out.log:/usr/src/swdashboard/publisher.log:ro" \
    --volume="/data/nginx/log/access/swpublisher.entu.eu.log:/usr/src/swdashboard/access.log:ro" \
    swdashboard:latest

printf "\n\n"
docker exec nginx /etc/init.d/nginx reload
