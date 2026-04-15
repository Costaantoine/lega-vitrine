FROM bvi-api:latest
WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn asyncpg httpx python-multipart aiofiles PyJWT==2.8.0 beautifulsoup4
COPY *.py .
RUN mkdir -p /app/uploads
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
