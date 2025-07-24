import logger from '../utils/logger-frontend';

const PLAIN_API_URL = 'https://core-api.uk.plain.com/graphql/v1';

class PlainService {
  constructor() {
    this.apiKey = import.meta.env.VITE_PLAIN_API_KEY;
    if (!this.apiKey) {
      logger.warn('Plain API key not found in environment variables');
    }
  }

  async createTicket(customerData, ticketData) {
    try {
      if (!this.apiKey) {
        throw new Error('Plain API key not configured');
      }

      // First upsert the customer
      const customer = await this.upsertCustomer(customerData);
      
      // Then create the thread
      const thread = await this.createThread(customer.id, ticketData);
      
      return {
        success: true,
        customer,
        thread,
        message: 'Ticket created successfully'
      };
    } catch (error) {
      logger.error('Error creating Plain ticket:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async upsertCustomer(customerData) {
    const query = `
      mutation upsertCustomer($input: UpsertCustomerInput!) {
        upsertCustomer(input: $input) {
          customer {
            id
            fullName
            email {
              email
              isVerified
            }
            createdAt {
              iso8601
            }
          }
          error {
            code
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        identifier: {
          emailAddress: customerData.email
        },
        onCreate: {
          fullName: customerData.name,
          email: {
            email: customerData.email,
            isVerified: false
          }
        },
        onUpdate: {
          fullName: {
            value: customerData.name
          }
        }
      }
    };

    const response = await this.makeGraphQLRequest(query, variables);
    
    if (response.data?.upsertCustomer?.error) {
      throw new Error(response.data.upsertCustomer.error.message);
    }

    return response.data.upsertCustomer.customer;
  }

  async createThread(customerId, ticketData) {
    const query = `
      mutation createThread($input: CreateThreadInput!) {
        createThread(input: $input) {
          thread {
            id
            title
            status
            createdAt {
              iso8601
            }
            customer {
              id
              fullName
              email {
                email
              }
            }
          }
          error {
            code
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        title: `ADAdev.io Developer Request: ${ticketData.name}`,
        description: `**Name:** ${ticketData.name}\n**Email:** ${ticketData.email}\n\n**Description:**\n${ticketData.description}`,
        customerIdentifier: {
          customerId: customerId
        }
      }
    };

    const response = await this.makeGraphQLRequest(query, variables);
    
    if (response.data?.createThread?.error) {
      throw new Error(response.data.createThread.error.message);
    }

    return response.data.createThread.thread;
  }

  async makeGraphQLRequest(query, variables) {
    try {
      const requestBody = {
        query,
        variables
      };
      
      logger.info('Plain API request:', {
        url: PLAIN_API_URL,
        query: query.trim(),
        variables
      });

      const response = await fetch(PLAIN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Plain API HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        logger.error('Plain API GraphQL errors:', data.errors);
        throw new Error(data.errors[0]?.message || 'GraphQL error');
      }

      logger.info('Plain API response:', data);
      return data;
    } catch (error) {
      logger.error('Plain API request failed:', error);
      throw error;
    }
  }
}

export default new PlainService(); 