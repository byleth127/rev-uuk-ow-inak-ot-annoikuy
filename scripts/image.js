const fsPromises = require("fs/promises");
const path = require("path");
const sizeOf = require("image-size");
const CWebp = require("cwebp").CWebp;
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const {
  searchFiles,
  getDirectories,
  getFileExtension,
  deleteFiles,
  getFileSize,
} = require("./utils/file");
const {
  naturalCompare,
  padNumber,
  escapeFilePathForPattern,
} = require("./utils/string");
const { pLimit } = require("./utils/pool");

const ENLARGE_WORKERS_COUNT = 2;
const COMPRESS_WORKERS_COUNT = 3;
const WAIFU2X_BIN_PATH = path.join(
  process.cwd(),
  "./scripts/static/waifu2x/waifu2x-ncnn-vulkan.exe"
);
const ENLARGED_FILE_PREFIX = "hentie2110";
const WAIFU2X_SUFFIX = "waifu2x";
const COMPRESSED_FILE_PREFIX = "compressed";
const MIN_WIDTH_SKIP_ENLARGE = 2000;
const MAX_PAGE_WIDTH = 4096;
const IDEAL_PAGE_WIDTH = 2048;
const IDEAL_THUMBNAIL_WIDTH = 600;

async function compressFile(filePath, enlargedTargetWidth, maximumWidth) {
  const fileExtension = getFileExtension(filePath);
  const fileDirectory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const fileNameWithoutExtension = fileName.replace(`.${fileExtension}`, "");
  const newFileNameWithoutExtension = `${COMPRESSED_FILE_PREFIX}_${fileNameWithoutExtension}`;

  const newWebpFilePath = `${fileDirectory}/${newFileNameWithoutExtension}.webp`;
  const { width, height } = sizeOf(filePath);
  const encoder = new CWebp(filePath);
  const isEnlargedImage = fileName.includes(WAIFU2X_SUFFIX);

  if (isEnlargedImage) {
    // Always resize enlarged image to target ideal width
    encoder.resize(enlargedTargetWidth, 0);
  } else {
    // For original image, we will only resize if it exceeds maximum width
    if (width > maximumWidth) {
      encoder.resize(maximumWidth, 0);
    }
  }
  encoder.quality(100);
  await encoder.write(newWebpFilePath);

  const webpFileSize = await getFileSize(newWebpFilePath);
  const originalFileSize = await getFileSize(filePath);

  // Always use WebP image when the result size is smaller
  if (originalFileSize > webpFileSize) {
    return;
  }

  // Delete the WebP image & simply copy the image
  console.log(
    `Image ${fileName} has a larger-sized converted WebP image so we will just use the original image...`
  );
  await deleteFiles([newWebpFilePath]);
  const targetFilePath = path.join(
    fileDirectory,
    `./${newFileNameWithoutExtension}.${fileExtension}`
  );
  await fsPromises.copyFile(filePath, targetFilePath);
}

async function enlargeFile(filePath, index) {
  const fileExtension = getFileExtension(filePath);
  const fileDirectory = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const { width, height } = sizeOf(filePath);
  const targetFileName = `${ENLARGED_FILE_PREFIX}_${padNumber(index)}`;

  if (width < MIN_WIDTH_SKIP_ENLARGE) {
    // Need to enlarge the image
    const absoluteTargetFilePath = path.resolve(
      process.cwd(),
      fileDirectory,
      `${targetFileName}_${WAIFU2X_SUFFIX}.png`
    );
    const absoluteFilePath = path.resolve(process.cwd(), filePath);
    const scale = width < MIN_WIDTH_SKIP_ENLARGE / 2 ? 4 : 2;
    console.log(
      `Enlarging image ${fileName} with Waifu2x at scale x${scale}...`
    );
    try {
      await exec(
        `${WAIFU2X_BIN_PATH} -i "${absoluteFilePath}" -o "${absoluteTargetFilePath}" -n 0 -s ${scale} -t 512 -m models-cunet -g 0 -j 2:2:2 -f png`
      );
      await fsPromises.access(absoluteTargetFilePath);
    } catch (err) {
      console.error(
        `Failed to enlarge image ${fileName} with Waifu2x at scale x${scale}!`,
        err
      );
      throw err;
    }
  } else {
    // Simply copy the image
    console.log(`Duplicating image ${fileName}...`);
    const targetFilePath = path.join(
      fileDirectory,
      `./${targetFileName}.${fileExtension}`
    );
    await fsPromises.copyFile(filePath, targetFilePath);
  }
}

async function processTitle(titleDirPath) {
  const titleDirPattern = escapeFilePathForPattern(titleDirPath);
  const titleName = path.basename(titleDirPath);
  console.log(`Processing title '${titleName}'...`);
  let filePaths = await searchFiles(`${titleDirPattern}/*.{png,jpg,jpeg}`);

  // Sort file paths in natural order
  filePaths.sort(naturalCompare);

  const thumbnailPaths = filePaths.filter((filePath) =>
    filePath.startsWith(`${titleDirPath}/thumbnail`)
  );
  filePaths = filePaths.filter(
    (filePath) => !filePath.startsWith(`${titleDirPath}/thumbnail`)
  );

  // Folder is either empty or has already been processed previously
  if (filePaths.length === 0) {
    console.log(`No images found under title '${titleName}'!`);
    return;
  }

  // Automatically create thumbnail (if needed) by using the first page
  let autoThumbnailPath;
  if (thumbnailPaths.length === 0) {
    console.log(
      `Duplicating first page for thumbnail under title '${titleName}'...`
    );
    const firstFilePath = filePaths[0];
    const firstFileExtension = getFileExtension(firstFilePath);
    const autoThumbnailPath = path.join(
      titleDirPath,
      `./thumbnail.${firstFileExtension}`
    );
    await fsPromises.copyFile(firstFilePath, autoThumbnailPath);
    thumbnailPaths.push(autoThumbnailPath);
  }

  // Enlarge images with Waifu2x if needed
  console.log(`Enlarging images (if needed) under title '${titleName}'...`);
  let enlargeError;
  const enlargePoolLimit = pLimit(ENLARGE_WORKERS_COUNT);
  const enlargeTasks = filePaths.map((filePath, index) =>
    enlargePoolLimit(() => enlargeFile(filePath, index + 1))
  );
  try {
    await Promise.all(enlargeTasks);
  } catch (err) {
    enlargeError = err;
  }

  const enlargedFilePaths = await searchFiles(
    `${titleDirPattern}/${ENLARGED_FILE_PREFIX}_*.{png,jpg,jpeg,webp}`
  );

  if (enlargeError != null) {
    console.error(
      `Failed to enlarge all images under title '${titleName}'!`,
      enlargeError
    );
    await deleteFiles([
      ...enlargedFilePaths,
      ...(autoThumbnailPath != null ? [autoThumbnailPath] : []),
    ]);
    return;
  }

  // Sort enlarged file paths in natural order
  enlargedFilePaths.sort(naturalCompare);

  // Compress enlarged images & thumbnails to WebP format and resize to ideal size
  console.log(
    `Compressing & resizing enlarged images under title '${titleName}'...`
  );
  let compressError;
  const compressPoolLimit = pLimit(COMPRESS_WORKERS_COUNT);
  const compressPageTasks = enlargedFilePaths.map((filePath) =>
    compressPoolLimit(() =>
      compressFile(filePath, IDEAL_PAGE_WIDTH, MAX_PAGE_WIDTH)
    )
  );
  const compressThumbnailTasks = thumbnailPaths.map((filePath) =>
    compressPoolLimit(() =>
      compressFile(filePath, IDEAL_THUMBNAIL_WIDTH, IDEAL_THUMBNAIL_WIDTH)
    )
  );
  try {
    await Promise.all([...compressPageTasks, ...compressThumbnailTasks]);
  } catch (err) {
    compressError = err;
  }

  const compressedFilePaths = await searchFiles(
    `${titleDirPattern}/${COMPRESSED_FILE_PREFIX}_*`
  );

  if (compressError != null) {
    console.error(
      `Failed to compress & resize all enlarged images under title '${titleName}'!`,
      compressError
    );
    await deleteFiles([
      ...enlargedFilePaths,
      ...compressedFilePaths,
      ...(autoThumbnailPath != null ? [autoThumbnailPath] : []),
    ]);
    return;
  }

  // Delete original & enlarged images
  console.log(`Cleaning up old images under title '${titleName}'...`);
  await deleteFiles([...filePaths, ...enlargedFilePaths, ...thumbnailPaths]);

  console.log(`Processed title '${titleName}' successfully!`);
}

(async () => {
  console.log("Scanning titles...");
  const directories = await getDirectories("content/");

  for (const dir of directories) {
    await processTitle(`content/${dir}`);
  }
})();
