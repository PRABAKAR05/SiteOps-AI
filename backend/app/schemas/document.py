from pydantic import Field

from app.schemas.auth import Strict


class AskIn(Strict):
    question: str = Field(min_length=3, max_length=1000)


class ProjectAskIn(Strict):
    project_id: str = Field(min_length=24, max_length=24)
    question: str = Field(min_length=3, max_length=1000)
