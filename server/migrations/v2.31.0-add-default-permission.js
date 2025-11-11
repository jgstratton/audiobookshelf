/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a suquelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.31.0'
const migrationName = `${migrationVersion}-update-root-permission`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This migration adds the saveToCloud permission to all users with type 'root' or 'admin'.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  // Check if users table exists
  if (await queryInterface.tableExists('users')) {
    logger.info(`${loggerPrefix} Updating permissions for root and admin users`)

    // Get all users with type 'root' or 'admin'
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, username, type, permissions FROM users WHERE type IN ('root', 'admin')`
    )

    logger.info(`${loggerPrefix} Found ${users.length} root/admin users to update`)

    // Update each user's permissions
    for (const user of users) {
      try {
        // Parse the existing permissions JSON
        const permissions = user.permissions ? JSON.parse(user.permissions) : {}
        
        // Add saveToCloud permission if it doesn't already exist
        if (permissions.saveToCloud === undefined) {
          permissions.saveToCloud = true
          
          // Update the user's permissions
          await queryInterface.sequelize.query(
            `UPDATE users SET permissions = :permissions WHERE id = :id`,
            {
              replacements: {
                permissions: JSON.stringify(permissions),
                id: user.id
              }
            }
          )
          
          logger.info(`${loggerPrefix} Added saveToCloud permission to user: ${user.username}`)
        } else {
          logger.info(`${loggerPrefix} User ${user.username} already has saveToCloud permission`)
        }
      } catch (error) {
        logger.error(`${loggerPrefix} Error updating permissions for user ${user.username}:`, error)
      }
    }

    logger.info(`${loggerPrefix} Finished updating permissions`)
  } else {
    logger.info(`${loggerPrefix} users table does not exist`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This migration removes the saveToCloud permission from all users with type 'root' or 'admin'.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  // Check if users table exists
  if (await queryInterface.tableExists('users')) {
    logger.info(`${loggerPrefix} Removing saveToCloud permission from root and admin users`)

    // Get all users with type 'root' or 'admin'
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, username, type, permissions FROM users WHERE type IN ('root', 'admin')`
    )

    logger.info(`${loggerPrefix} Found ${users.length} root/admin users to update`)

    // Update each user's permissions
    for (const user of users) {
      try {
        // Parse the existing permissions JSON
        const permissions = user.permissions ? JSON.parse(user.permissions) : {}
        
        // Remove saveToCloud permission if it exists
        if (permissions.saveToCloud !== undefined) {
          delete permissions.saveToCloud
          
          // Update the user's permissions
          await queryInterface.sequelize.query(
            `UPDATE users SET permissions = :permissions WHERE id = :id`,
            {
              replacements: {
                permissions: JSON.stringify(permissions),
                id: user.id
              }
            }
          )
          
          logger.info(`${loggerPrefix} Removed saveToCloud permission from user: ${user.username}`)
        } else {
          logger.info(`${loggerPrefix} User ${user.username} does not have saveToCloud permission`)
        }
      } catch (error) {
        logger.error(`${loggerPrefix} Error updating permissions for user ${user.username}:`, error)
      }
    }

    logger.info(`${loggerPrefix} Finished removing permissions`)
  } else {
    logger.info(`${loggerPrefix} users table does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}
 

module.exports = { up, down }
