function naturalCompare(s1, s2) {
  return s1.localeCompare(s2, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function reverse(str) {
  return str.split("").reverse().join("");
}

function padNumber(n, padCount = 3) {
  return String(n).padStart(padCount, "0");
}

function decrypt(str) {
  if (str.startsWith("Rev ")) {
    return reverse(str.substring(4));
  }

  return str;
}

function escapeFilePathForPattern(filePath) {
  const arr = [];
  for (const c of filePath) {
    if (c === "[") {
      arr.push("[[]");
    } else if (c === "]") {
      arr.push("[]]");
    } else {
      arr.push(c);
    }
  }

  return arr.join("");
}

module.exports = {
  naturalCompare,
  reverse,
  padNumber,
  decrypt,
  escapeFilePathForPattern,
};
