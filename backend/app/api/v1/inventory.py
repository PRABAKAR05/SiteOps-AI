from fastapi import APIRouter

from app.api.deps import CurrentUser, Pagination
from app.schemas.inventory import ForecastQuery, MaterialCreate, MaterialUpdate, TransactionCreate
from app.services import inventory_service
from app.services.project_service import access

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/materials")
def list_materials(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    category: str | None = None,
    q: str | None = None,
    low_only: bool = False,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return inventory_service.list_materials(
        ctx, category=category, q=q, low_only=low_only, page_no=page_no, page_size=page_size
    )


@router.post("/materials", status_code=201)
def create_material(payload: MaterialCreate, user: CurrentUser):
    ctx = access(user, payload.project_id)
    return inventory_service.create_material(ctx, payload)


@router.get("/materials/{material_id}")
def get_material(material_id: str, project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return inventory_service.get_material(ctx, material_id)


@router.put("/materials/{material_id}")
def update_material(material_id: str, project_id: str, payload: MaterialUpdate, user: CurrentUser):
    ctx = access(user, project_id)
    return inventory_service.update_material(ctx, material_id, payload)


@router.post("/transactions", status_code=201)
def create_transaction(payload: TransactionCreate, user: CurrentUser):
    ctx = access(user, payload.project_id)
    return inventory_service.transact(ctx, payload)


@router.get("/transactions")
def list_transactions(
    project_id: str,
    user: CurrentUser,
    pg: Pagination,
    material_id: str | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    ctx = access(user, project_id)
    page_no, page_size = pg
    return inventory_service.list_transactions(
        ctx, material_id=material_id, type_=type, date_from=date_from, date_to=date_to,
        page_no=page_no, page_size=page_size,
    )


@router.get("/alerts")
def alerts(project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return {"items": inventory_service.alerts(ctx)}


@router.get("/forecast")
def forecast(project_id: str, user: CurrentUser, horizon_days: int = 14):
    ctx = access(user, project_id)
    return inventory_service.forecast(ctx, horizon_days=horizon_days)


@router.get("/reconcile")
def reconcile(project_id: str, user: CurrentUser):
    ctx = access(user, project_id)
    return {"items": inventory_service.reconcile(ctx)}
