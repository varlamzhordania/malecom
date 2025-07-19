#!/bin/bash
# View application logs

SERVICE=${1:-all}

case $SERVICE in
    "backend"|"api")
        docker-compose logs -f backend
        ;;
    "frontend"|"web")
        docker-compose logs -f frontend
        ;;
    "database"|"db")
        docker-compose logs -f database
        ;;
    "redis")
        docker-compose logs -f redis
        ;;
    "nginx")
        docker-compose logs -f nginx
        ;;
    "all"|*)
        docker-compose logs -f
        ;;
esac