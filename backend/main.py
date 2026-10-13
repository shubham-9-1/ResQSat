
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Integer,
    String,
    create_engine,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


# --------------------------------------------------
# 1. DATABASE CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = f"sqlite:///{(BASE_DIR / 'resqsat.db').as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------
# 2. DATABASE MODEL
# --------------------------------------------------

class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150))
    disaster_type: Mapped[str] = mapped_column(String(30), default="flood")
    severity: Mapped[str] = mapped_column(String(20))
    location: Mapped[str] = mapped_column(String(150))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    estimated_population: Mapped[int] = mapped_column(Integer, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


# --------------------------------------------------
# 3. API REQUEST SCHEMA
# --------------------------------------------------

class IncidentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    disaster_type: str = Field(default="flood", max_length=30)
    severity: str = Field(default="medium", max_length=20)
    location: str = Field(min_length=2, max_length=150)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    estimated_population: int = Field(default=0, ge=0)


def incident_to_dict(incident: Incident) -> dict:
    return {
        "id": incident.id,
        "name": incident.name,
        "disaster_type": incident.disaster_type,
        "severity": incident.severity,
        "location": incident.location,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
        "estimated_population": incident.estimated_population,
        "is_demo": incident.is_demo,
        "created_at": incident.created_at.isoformat(),
    }


# --------------------------------------------------
# 4. DATABASE SESSION
# --------------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------
# 5. STARTUP AND DEMO DATA
# --------------------------------------------------

def seed_demo_data():
    with SessionLocal() as db:
        existing = db.scalar(select(Incident.id).limit(1))

        if existing is not None:
            return

        demo_incidents = [
            Incident(
                name="Flood Risk Zone A",
                disaster_type="flood",
                severity="high",
                location="Patna District, Bihar",
                latitude=25.61,
                longitude=85.14,
                estimated_population=12400,
                is_demo=True,
            ),
            Incident(
                name="Flood Risk Zone B",
                disaster_type="flood",
                severity="medium",
                location="Hajipur Region, Bihar",
                latitude=25.69,
                longitude=85.21,
                estimated_population=5800,
                is_demo=True,
            ),
        ]

        db.add_all(demo_incidents)
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_demo_data()
    yield


# --------------------------------------------------
# 6. FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="ResQSat API",
    description=(
        "Disaster response prototype API. "
        "Bundled incidents are illustrative demo data, not live warnings."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
   allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --------------------------------------------------
# 7. API ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "project": "ResQSat",
        "message": "Disaster Response API is running",
        "version": "0.1.0",
        "demo_mode": True,
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "database": "configured",
        "demo_mode": True,
    }


@app.get("/api/incidents")
def get_incidents(db: Session = Depends(get_db)):
    incidents = db.scalars(
        select(Incident).order_by(Incident.id)
    ).all()

    return {
        "count": len(incidents),
        "data_source": "bundled_demo",
        "incidents": [incident_to_dict(item) for item in incidents],
    }


@app.get("/api/incidents/{incident_id}")
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
):
    incident = db.get(Incident, incident_id)

    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")

    return incident_to_dict(incident)


@app.post("/api/incidents", status_code=201)
def create_incident(
    payload: IncidentCreate,
    db: Session = Depends(get_db),
):
    incident = Incident(
        **payload.model_dump(),
        is_demo=True,
    )

    db.add(incident)
    db.commit()
    db.refresh(incident)

    return incident_to_dict(incident)
