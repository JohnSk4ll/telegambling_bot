# Развертывание Telegram Gambling Bot в Docker на TrueNAS

## Быстрый старт (одной командой)

### Вариант 1: Клонирование и запуск
```bash
# Клонируем репозиторий, создаём .env и запускаем
git clone https://github.com/JohnSk4ll/telegambling_bot.git && \
cd telegambling_bot && \
echo "TELEGRAM_BOT_TOKEN=ваш_токен_бота" > .env && \
docker-compose up -d --build
```

### Вариант 2: Прямой запуск из GitHub (без клонирования)
```bash
# Создаём директорию и скачиваем только нужные файлы
mkdir -p ~/telegambling_bot && cd ~/telegambling_bot && \
curl -o docker-compose.yml https://raw.githubusercontent.com/JohnSk4ll/telegambling_bot/main/docker-compose.yml && \
curl -o Dockerfile https://raw.githubusercontent.com/JohnSk4ll/telegambling_bot/main/Dockerfile && \
echo "TELEGRAM_BOT_TOKEN=ваш_токен_бота" > .env && \
mkdir -p data uploads && \
docker-compose up -d --build
```

---

## Пошаговая установка

### Шаг 1: Подключение к TrueNAS по SSH
```bash
ssh root@ваш_truenas_ip
```

### Шаг 2: Клонирование репозитория
```bash
cd /mnt/ваш_пул/docker  # или любая другая директория для Docker-контейнеров
git clone https://github.com/JohnSk4ll/telegambling_bot.git
cd telegambling_bot
```

### Шаг 3: Настройка переменных окружения
```bash
# Создайте .env файл с вашим токеном Telegram бота
nano .env
```

Содержимое файла `.env`:
```env
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather
```

Сохраните файл (Ctrl+O, Enter, Ctrl+X в nano).

### Шаг 4: Создание необходимых директорий
```bash
mkdir -p data uploads
```

### Шаг 5: Запуск контейнера
```bash
# Сборка и запуск
docker-compose up -d --build
```

### Шаг 6: Проверка статуса
```bash
# Проверить запущен ли контейнер
docker-compose ps

# Посмотреть логи
docker-compose logs -f

# Проверить что бот работает
curl http://localhost:5051
```

---

## Управление контейнером

### Просмотр логов
```bash
docker-compose logs -f
```

### Перезапуск бота
```bash
docker-compose restart
```

### Остановка бота
```bash
docker-compose down
```

### Обновление бота до новой версии
```bash
# Остановить текущий контейнер
docker-compose down

# Получить последнюю версию
git pull

# Пересобрать и запустить
docker-compose up -d --build
```

### Полная очистка и переустановка
```bash
docker-compose down -v  # удалит контейнер и volumes
docker system prune -a  # очистить неиспользуемые образы
git pull
docker-compose up -d --build
```

---

## Доступ к админ-панели

После запуска админ-панель будет доступна по адресу:
```
http://ваш_truenas_ip:5051
```

---

## Резервное копирование данных

Важные данные хранятся в:
- `./data/` - база данных пользователей и кейсов
- `./uploads/` - загруженные изображения предметов

Рекомендуется регулярно делать backup этих папок:
```bash
# Создать backup
tar -czf backup-$(date +%Y%m%d).tar.gz data/ uploads/

# Восстановить из backup
tar -xzf backup-20251219.tar.gz
```

---

## Настройка портов

Если порт 5051 занят, измените его в `docker-compose.yml`:
```yaml
ports:
  - "8080:5051"  # внешний:внутренний
```

---

## Устранение проблем

### Контейнер не запускается
```bash
# Проверить логи
docker-compose logs

# Проверить что порт свободен
netstat -tuln | grep 5051
```

### Бот не отвечает в Telegram
- Проверьте что токен в `.env` правильный
- Убедитесь что контейнер запущен: `docker-compose ps`
- Проверьте логи: `docker-compose logs -f`

### Нет доступа к админ-панели
- Проверьте что порт 5051 открыт в фаерволе TrueNAS
- Попробуйте: `curl http://localhost:5051` на самом TrueNAS

---

## Docker команды для TrueNAS (альтернативный метод без docker-compose)

Если docker-compose недоступен, можно запустить напрямую:

```bash
# Сборка образа
docker build -t telegambling_bot https://github.com/JohnSk4ll/telegambling_bot.git

# Создание volumes
docker volume create telegambling_data
docker volume create telegambling_uploads

# Запуск контейнера
docker run -d \
  --name telegambling_bot \
  --restart unless-stopped \
  -p 5051:5051 \
  -e TELEGRAM_BOT_TOKEN="ваш_токен" \
  -v telegambling_data:/app/data \
  -v telegambling_uploads:/app/src/public/uploads \
  telegambling_bot

# Проверка логов
docker logs -f telegambling_bot

# Остановка
docker stop telegambling_bot

# Удаление
docker rm telegambling_bot
```

---

## Автоматический перезапуск при обновлении

Создайте скрипт для автоматического обновления:

```bash
nano /root/update-telegambling.sh
```

Содержимое:
```bash
#!/bin/bash
cd /mnt/ваш_пул/docker/telegambling_bot
docker-compose down
git pull
docker-compose up -d --build
echo "Bot updated at $(date)" >> update.log
```

Сделайте скрипт исполняемым:
```bash
chmod +x /root/update-telegambling.sh
```

Добавьте в cron для еженедельного обновления:
```bash
crontab -e
```

Добавьте строку:
```
0 3 * * 0 /root/update-telegambling.sh
```

---

## Мониторинг

Проверка что бот работает:
```bash
# HTTP проверка
curl -s http://localhost:5051 | head -n 1

# Проверка процесса
docker-compose top

# Использование ресурсов
docker stats telegambling_telegambling_1
```

---

## Полезные ссылки

- GitHub репозиторий: https://github.com/JohnSk4ll/telegambling_bot
- Создание Telegram бота: https://t.me/BotFather
- Docker документация: https://docs.docker.com/
