function check() {
    let gameName = document.getElementById('gameToCheck').value;

    if (!gameName) {
        alert('Введите название настолки');
        return;
    }

    gameName = gameName.trim();

    if (!gameName) {
        alert('Название настолки не должно быть пустым');
        return;
    }

    const database = document.getElementById('input').value;

    if (!database) {
        alert('Введите базу данных');
        return;
    }

    if (doCheck(gameName, database)) {
        alert('Такая настолка уже есть в базе данных');
        return;
    } else {
        alert('Такой настолки нет в базе данных');
        return;
    }
}

function doCheck(gameName, databaseText) {
    const database = JSON.parse(databaseText);

    const hash = hashGameName(gameName);

    return database[hash] !== undefined;
}

function add() {
    let gameName = document.getElementById('gameToAdd').value;

    if (!gameName) {
        alert('Введите название настолки');
        return;
    }

    gameName = gameName.trim();

    if (!gameName) {
        alert('Название настолки не должно быть пустым');
        return;
    }

    const database = document.getElementById('input').value;

    if (!database) {
        alert('Введите базу данных');
        return;
    }

    if (doCheck(gameName, database)) {
        alert('Такая настолка уже есть в базе данных');
        return;
    } else {
        doAdd(gameName, database);
        alert('Настолка успешно добавлена в базу данных');
        return;
    }
}

function doAdd(gameName, databaseText) {
    const database = JSON.parse(databaseText);

    const hash = hashGameName(gameName);

    database[hash] = true;

    document.getElementById('input').value = JSON.stringify(database);
}

function hashGameName(gameName) {
    return hashCode(gameName.toLowerCase());
}

hashCode = function(s) {
    return s.split("").reduce(function(a, b) {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
}
