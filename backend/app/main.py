import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy import text

from .core import frontend
from .core.config import settings
from .core.database import create_tables, engine
from .engine.playbook import playbooks
from .engine.scheduler import auto_flow
from .routes import cases, decisions, extracted_data, lm_stages, msp, processes, retention, runs, workflow
import os
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")



@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_tables()
    playbooks()

    # Render builds the frontend during deployment.
    # Local development can build and watch frontend changes.
    is_render = os.getenv("RENDER", "").lower() == "true"

    if not is_render:
        frontend.ensure_built()
        frontend.start_watcher()
    else:
        logging.info("Render detected: skipping frontend rebuild and watcher.")

    auto_flow.start()

    yield

    auto_flow.stop()

    if not is_render:
        frontend.stop_watcher()



app = FastAPI(
    title="Mortgage Agentic Workbench API",
    description="Loss Mitigation backend — data (msp, extracted_data, lm_stages), the YAML-driven LangGraph engine, runs and the Decision Inbox.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for module in (msp, extracted_data, lm_stages, processes, retention, workflow, decisions, runs, cases):
    app.include_router(module.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "database": engine.dialect.name}


# The React app, served from this same port (see app/core/frontend.py). Registered last so
# every /api route wins; anything else is a static file from frontend/dist or the SPA's index.html.
@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str) -> Response:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    file = frontend.resolve(full_path)
    if file is not None:
        return FileResponse(file)
    if frontend.INDEX.is_file():
        return FileResponse(frontend.INDEX, headers={"Cache-Control": "no-cache"})
    return HTMLResponse(
        "<h1>Frontend not built</h1><p>Run <code>npm run build</code> in <code>frontend/</code>, "
        "or install Node so the server can build it on startup. The API is up at <a href='/docs'>/docs</a>.</p>",
        status_code=503,
    )
