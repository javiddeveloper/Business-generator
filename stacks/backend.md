# Backend Stack Configuration

## Language
Python

## Framework
Django

## Hard Skills
Django, Django REST Framework, PostgreSQL, Clean Architecture, pytest, pytest-django

## Code Style & Principles
- Clean Code
- SOLID principles
- Repository pattern
- Service layer separation

## Base Architecture (optional)
<!-- Paste a GitHub URL to a reference architecture you want to follow -->
<!-- Example: https://github.com/user/clean-django-architecture -->

## Rules
- All code must live under `backend/` as a fully runnable package
- `requirements.txt` must include: django, djangorestframework, psycopg2-binary, pytest, pytest-django
- `manage.py` at root of `backend/`
- `settings.py` with environment-based config (use os.environ)
- Apps organized by domain (e.g. `backend/users/`, `backend/products/`)
- Minimum 3 unit tests using **pytest** with `pytest-django` fixtures
- Test files named `test_*.py`
