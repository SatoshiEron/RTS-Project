export default class MapLoader {

    static async load(path = "maps/world.json") {
        const response = await fetch(path);
        const world = await response.json();

        const map = {
            roads: [],
            rails: [],
            rivers: [],
            provinces: [],
            cities: [],
            graph: {} // граф связности точек
        };

        // Вспомогательная функция для графа
        function addToGraph(fromId, toId) {
            if (!map.graph[fromId]) map.graph[fromId] = [];
            if (!map.graph[toId]) map.graph[toId] = [];
            if (!map.graph[fromId].includes(toId)) map.graph[fromId].push(toId);
            if (!map.graph[toId].includes(fromId)) map.graph[toId].push(fromId);
        }

        for (const obj of world.objects) {

            // ===== дороги / ж/д / реки =====
            if (obj.type === "road" || obj.type === "rail" || obj.type === "river") {
                map[obj.type + "s"].push({
                    id: obj.id,
                    type: obj.type,
                    points: obj.points
                });

                // города встроены в точки дорог
                for (const p of obj.points) {
                    if (p.isCity) {
                        map.cities.push({
                            id: p.id,
                            parentId: obj.id,
                            x: p.x,
                            y: p.y,
                            type: p.cityType || "city",
                            name: p.name || ("City_" + p.id),
                            provinceId: null // пока не знаем, позже привяжем
                        });
                    }
                }

                // строим граф связности
                for (let i = 0; i < obj.points.length - 1; i++) {
                    addToGraph(obj.points[i].id, obj.points[i + 1].id);
                }
            }

            // ===== провинции =====
            if (obj.type === "province") {
                const cx = obj.vertices.reduce((s, v) => s + v.x, 0) / obj.vertices.length;
                const cy = obj.vertices.reduce((s, v) => s + v.y, 0) / obj.vertices.length;

                map.provinces.push({
                    id: obj.id,
                    vertices: obj.vertices,
                    center: { x: cx, y: cy },
                    name: obj.properties?.name || ("Province_" + obj.id),
                    owner: 0,      // 0 — нейтрал
                    level: 1,      // уровень развития
                    garrison: 0    // гарнизон
                });
            }
        }

        // ===== связь город ↔ провинция =====
        for (const city of map.cities) {
            for (const prov of map.provinces) {
                // простая проверка: если город внутри полигона провинции
                if (pointInPolygon({x: city.x, y: city.y}, prov.vertices)) {
                    city.provinceId = prov.id;
                    break;
                }
            }
        }

        return map;
    }
}

// ===== утилита: проверка точки в полигоне =====
function pointInPolygon(point, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}