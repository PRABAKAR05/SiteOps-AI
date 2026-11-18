"""Role capability matrix.

Routes declare a capability; the matrix decides which roles hold it. Keeping
this as data lets tests assert every role/route combination in one place.
"""

CAPABILITIES: dict[str, set[str]] = {
    "project:create": {"project_manager"},
    "project:update": {"project_manager"},
    "project:members": {"project_manager"},
    "report:create": {"project_manager", "site_engineer", "supervisor"},
    "report:approve": {"project_manager"},
    "inventory:manage": {"project_manager", "storekeeper"},
    "inventory:consume": {"project_manager", "site_engineer", "supervisor", "storekeeper"},
    "issue:create": {"project_manager", "site_engineer", "supervisor", "storekeeper"},
    "issue:assign": {"project_manager"},
    "issue:resolve": {"project_manager", "site_engineer", "supervisor"},
    "task:create": {"project_manager", "site_engineer"},
    "invoice:upload": {"project_manager", "storekeeper"},
    "invoice:verify": {"project_manager", "storekeeper"},
    "document:upload": {"project_manager", "site_engineer", "supervisor", "storekeeper"},
    "document:delete_any": {"project_manager"},
    "analytics:period_reports": {"project_manager"},
}


def role_has(role: str, capability: str) -> bool:
    return role in CAPABILITIES.get(capability, set())


def roles_for(capability: str) -> set[str]:
    return CAPABILITIES.get(capability, set())
