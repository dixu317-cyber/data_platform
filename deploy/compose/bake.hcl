variable "FF_IMAGE_PREFIX" {
  default = "ff-companybrain"
}

variable "FF_IMAGE_TAG" {
  default = "latest"
}

group "default" {
  targets = [
    "web",
    "api",
    "agent-gateway",
    "nano-brain",
    "traditional-rag",
    "graph-rag",
    "neo4j",
    "migrate",
  ]
}

target "web" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.web"
  target     = "web"
  tags       = ["${FF_IMAGE_PREFIX}/web:${FF_IMAGE_TAG}"]
}

target "api" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.bun-service"
  target     = "api"
  tags       = ["${FF_IMAGE_PREFIX}/api:${FF_IMAGE_TAG}"]
}

target "agent-gateway" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.bun-service"
  target     = "agent-gateway"
  tags       = ["${FF_IMAGE_PREFIX}/agent-gateway:${FF_IMAGE_TAG}"]
}

target "nano-brain" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.bun-service"
  target     = "nano-brain"
  tags       = ["${FF_IMAGE_PREFIX}/nano-brain:${FF_IMAGE_TAG}"]
}

target "traditional-rag" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.python-service"
  target     = "traditional-rag"
  tags       = ["${FF_IMAGE_PREFIX}/traditional-rag:${FF_IMAGE_TAG}"]
}

target "graph-rag" {
  context    = "../.."
  dockerfile = "deploy/compose/Dockerfile.python-service"
  target     = "graph-rag"
  tags       = ["${FF_IMAGE_PREFIX}/graph-rag:${FF_IMAGE_TAG}"]
}

target "neo4j" {
  context = "../database/neo4j"
  tags    = ["${FF_IMAGE_PREFIX}/neo4j:${FF_IMAGE_TAG}"]
}

target "migrate" {
  context    = "../.."
  dockerfile = "deploy/database/Dockerfile.migrate"
  tags       = ["${FF_IMAGE_PREFIX}/migrate:${FF_IMAGE_TAG}"]
}
