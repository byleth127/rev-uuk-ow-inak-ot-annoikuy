const fsPromises = require("fs/promises");
const glob = require("glob");
const path = require("path");

const { pLimit } = require("./pool");

const DELETE_WORKERS_COUNT = 10;

async function searchFiles(pattern) {
  return new Promise((resolve, reject) => {
    glob(pattern, {}, (err, matches) => {
      if (err != null) {
        reject(err);
      } else {
        resolve(matches);
      }
    });
  });
}

async function deleteFiles(filePaths) {
  const deletePoolLimit = pLimit(DELETE_WORKERS_COUNT);
  const deleteTasks = filePaths.map((filePath, index) =>
    deletePoolLimit(() => fsPromises.unlink(filePath))
  );
  await Promise.all(deleteTasks);
}

async function getDirectories(parentPath) {
  const dirents = await fsPromises.readdir(parentPath, { withFileTypes: true });
  return dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}

async function getFileSize(filePath) {
  const stats = await fsPromises.stat(filePath);
  return stats.size;
}

function getFileExtension(filePath) {
  return path.extname(filePath).substring(1);
}

module.exports = {
  searchFiles,
  getDirectories,
  getFileExtension,
  deleteFiles,
  getFileSize,
};
