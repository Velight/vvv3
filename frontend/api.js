export class ApiError extends Error {
    constructor(status, detail) {
        super(status === 409 ? 'Данные изменились. Обновите карту и повторите правку.' : status === 401 ? 'Неверный ключ доступа.' : status === 403 ? 'Недостаточно прав для изменения.' : status === 502 ? 'Ассистент временно недоступен. Повторите запрос.' : typeof detail === 'string' ? detail : 'Проверьте введённые данные.');
        this.status = status;
        this.detail = detail;
    }
}
export class Api {
    constructor(key = '') {
        this.key = key;
    }
    async request(path, {
        method = 'GET',
        body,
        signal
    } = {}) {
        let response;
        try {
            response = await fetch('/api/v1' + path, {
                method,
                signal,
                headers: {
                    'X-API-Key': this.key,
                    ...(body ? {
                        'Content-Type': 'application/json'
                    } : {})
                },
                body: body ? JSON.stringify(body) : undefined
            });
        } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw new Error('Нет связи с сервером. Проверьте подключение и повторите запрос.');
        }
        const data = await response.json();
        if (!response.ok) throw new ApiError(response.status, data.detail ?? data);
        return data;
    }
    client(id, suffix = '') {
        return '/clients/' + encodeURIComponent(id) + suffix;
    }
    get(id, suffix, query = {}) {
        const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== ''));
        return this.request(this.client(id, suffix) + (params.size ? '?' + params : ''));
    }
    write(id, suffix, body, method = 'POST', version) {
        return this.request(this.client(id, suffix) + (version ? '?expected_version=' + version : ''), {
            method,
            body
        });
    }
}
