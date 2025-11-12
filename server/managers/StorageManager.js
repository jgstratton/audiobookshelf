const Logger = require('../Logger')
const Database = require('../Database')
const Path = require('path')
const fs = require('fs').promises

/**
 * Cloud Storage Manager for audiobookshelf caching
 * 
 * S3-compatible storage using AWS SDK v3:
 * npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
 * 
 * Supports: AWS S3, MinIO, DigitalOcean Spaces, and other S3-compatible services
 */
class StorageManager {
  constructor() {
    this.s3Client = null
    this.bucket = null
    this.isInitialized = false
    this.isS3Enabled = false
  }

  /**
   * Initialize storage based on server settings
   */
  async init() {
    try {
      const serverSettings = Database.serverSettings

      if (!serverSettings.cloudStorageEnabled) {
        Logger.info('[StorageManager] Cloud storage disabled')
        return
      }

      // only s3 is supported right now
      await this.initS3Storage(serverSettings)
      this.isInitialized = true
      Logger.info('[StorageManager] Storage initialized successfully')
    } catch (error) {
      Logger.error('[StorageManager] Failed to initialize storage:', error)
      throw error
    }
  }

  /**
   * Initialize S3 storage
   */
  async initS3Storage(settings) {
    if (!settings.cloudStorageS3Region || !settings.cloudStorageS3Bucket) {
      throw new Error('S3 storage requires region and bucket configuration')
    }

    if (!settings.cloudStorageS3AccessKey || !settings.cloudStorageS3SecretKey) {
      throw new Error('S3 storage requires access key and secret key')
    }

    Logger.info(`[StorageManager] Configuring S3 storage - Region: ${settings.cloudStorageS3Region}, Bucket: ${settings.cloudStorageS3Bucket}`)
    
    try {
      const { S3Client } = require('@aws-sdk/client-s3')
      
      const clientConfig = {
        region: settings.cloudStorageS3Region,
        credentials: {
          accessKeyId: settings.cloudStorageS3AccessKey,
          secretAccessKey: settings.cloudStorageS3SecretKey
        }
      }

      this.s3Client = new S3Client(clientConfig)
      this.bucket = settings.cloudStorageS3Bucket
      
      // Test the connection
      await this.testS3Connection()
      
    } catch (error) {
      Logger.error('[StorageManager] Failed to initialize S3 client:', error)
      throw error
    }
  }

  /**
   * Test S3 connection by checking if bucket exists
   */
  async testS3Connection() {
    try {
      const { HeadBucketCommand } = require('@aws-sdk/client-s3')
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }))
      Logger.info(`[StorageManager] Successfully connected to S3 bucket: ${this.bucket}`)
    } catch (error) {
      Logger.error(`[StorageManager] Failed to access S3 bucket ${this.bucket}:`, error.message)
      throw new Error(`S3 bucket access failed: ${error.message}`)
    }
  }

  /**
   * Convert a filename to S3-safe format (kebab-case with only alphanumeric characters, dashes, and forward slashes)
   * @param {string} fileName - The original filename
   * @returns {string} S3-safe filename in kebab-case
   */
  s3SafeFileName(fileName) {
    // Separate the extension from the filename
    const ext = fileName.lastIndexOf('.') > 0 ? fileName.substring(fileName.lastIndexOf('.')) : ''
    const nameWithoutExt = ext ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
    
    // Convert to kebab-case:
    // 1. Replace any non-alphanumeric characters (except spaces and forward slashes) with spaces
    // 2. Trim leading/trailing spaces
    // 3. Replace multiple spaces with single space
    // 4. Convert to lowercase
    // 5. Replace spaces with dashes
    const safeName = nameWithoutExt
      .replace(/[^a-zA-Z0-9\s\/]/g, ' ')  // Replace non-alphanumeric (except spaces and /) with spaces
      .trim()                             // Remove leading/trailing spaces
      .replace(/\s+/g, ' ')               // Replace multiple spaces with single space
      .toLowerCase()                      // Convert to lowercase
      .replace(/\s/g, '-')                // Replace spaces with dashes
    
    // Handle the extension
    const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, '')
    
    // remove leading slash
    return safeName.replace(/^\//, '') + safeExt
  }

  /**
   * Cache an audiobook file to S3 storage
   * @param {string} fileName - The filename to use for storage
   * @param {Buffer|Stream} data - The data (Buffer or Stream)
   * @returns {Promise<string>} The storage key/path
   */
  async cacheFile(fileName, data) {
    if (!this.isInitialized) {
      throw new Error('S3 storage not initialized')
    }

    const key = this.s3SafeFileName(fileName)
    
    try {
      const { Upload } = require('@aws-sdk/lib-storage')
      const { PutObjectCommand } = require('@aws-sdk/client-s3')

      if (Buffer.isBuffer(data)) {
        // Use PutObjectCommand for Buffer data
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data
        })
        await this.s3Client.send(command)
      } else {
        // Use Upload for Stream data (handles large files better)
        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: this.bucket,
            Key: key,
            Body: data
          }
        })
        await upload.done()
      }

      Logger.info(`[StorageManager] Cached audiobook to S3: ${key}`)
      return key
    } catch (error) {
      Logger.error(`[StorageManager] Failed to cache audiobook ${bookId} to S3:`, error)
      throw error
    }
  }

  /**
   * Get a signed URL for direct access to an audiobook in S3 storage
   * @param {string} fileName - The audiobook file name
   * @param {number} [expiresIn=3600] - URL expiration time in seconds (default: 1 hour)
   * @returns {Promise<string|null>} The pre-signed URL or null if not found
   */
  async getSignedUrlForFile(fileName, expiresIn = 3600) {
    if (!this.isInitialized) {
      Logger.info(`[StorageManager] S3 storage not initialized.`)
      return null;
    }

    const key = this.s3SafeFileName(fileName)

    try {
      // First check if the object exists
      const { HeadObjectCommand } = require('@aws-sdk/client-s3')
      const headCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
      
      await this.s3Client.send(headCommand)
      
      // Object exists, generate signed URL
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
      const { GetObjectCommand } = require('@aws-sdk/client-s3')
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
      
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn })
      Logger.info(`[StorageManager] Generated signed URL for audiobook: ${key} (expires in ${expiresIn}s)`)
      return signedUrl
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        Logger.debug(`[StorageManager] Audiobook not found in S3: ${key}`)
        return null
      }
      Logger.error(`[StorageManager] Failed to generate signed URL for audiobook ${itemId}:`, error)
      return null
    }
  }

  /**
   * Check if an audiobook exists in S3 storage
   * @param {string} bookId - The audiobook ID
   * @param {string} [filename] - Optional filename (defaults to audio.mp3)
   * @returns {Promise<boolean>}
   */
  async zipFileExists(itemId, filename = 'audio.mp3') {
    if (!this.isInitialized || !this.isS3Enabled) {
      return false
    }

    const key = this.s3SafeFileName(itemId, filename)
    
    try {
      const { HeadObjectCommand } = require('@aws-sdk/client-s3')
      
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
      
      await this.s3Client.send(command)
      return true
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return false
      }
      Logger.error(`[StorageManager] Failed to check audiobook existence ${bookId} in S3:`, error)
      return false
    }
  }
}

module.exports = new StorageManager()