
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.database import Base
from app.models.user import User  # noqa: F401
from app.models import onboarding  # noqa: F401
from app.models import brand_extraction  # noqa: F401
from app.models import intelligence  # noqa: F401
from app.models import content  # noqa: F401
from app.models import scheduling  # noqa: F401
from app.models import schedule_events  # noqa: F401
from app.models import brand_logo  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=settings.DATABASE_URL.render_as_string(
            hide_password=False
        ),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    configuration = config.get_section(
        config.config_ini_section,
        {}
    )

    configuration["sqlalchemy.url"] = (
        settings.DATABASE_URL.render_as_string(
            hide_password=False
        )
    )

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
