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

  getKey = (itemId) => `audiobooks/${itemId}.zip`

  /**
   * Cache an audiobook file to S3 storage
   * @param {string} itemId - The audiobook ID
   * @param {Buffer|Stream} data - The data (zip file)
   * @returns {Promise<string>} The storage key/path
   */
  async cacheZipFile(itemId, data) {
    if (!this.isInitialized) {
      throw new Error('S3 storage not initialized')
    }

    const key = this.getKey(itemId)
    
    try {
      const { Upload } = require('@aws-sdk/lib-storage')
      const { PutObjectCommand } = require('@aws-sdk/client-s3')

      if (Buffer.isBuffer(data)) {
        // Use PutObjectCommand for Buffer data
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: 'application/zip'
        })
        await this.s3Client.send(command)
      } else {
        // Use Upload for Stream data (handles large files better)
        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: 'application/zip'
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
   * @param {string} itemId - The audiobook ID
   * @param {number} [expiresIn=3600] - URL expiration time in seconds (default: 1 hour)
   * @returns {Promise<string|null>} The pre-signed URL or null if not found
   */
  async getSignedUrlForZipFile(itemId, expiresIn = 3600) {
    if (!this.isInitialized) {
      throw new Error('S3 storage not initialized')
    }

    const key = this.getKey(itemId)

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
      throw error
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

    const key = this.getKey(itemId, filename)
    
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