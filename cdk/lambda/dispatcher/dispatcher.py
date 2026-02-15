import boto3
import json
import os
import time

ecs = boto3.client('ecs')
dynamodb = boto3.resource('dynamodb')
jobs_table = dynamodb.Table(os.environ['JOBS_TABLE'])

def handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    for record in event['Records']:
        try:
            body = json.loads(record['body'])
            job_id = body.get('job_id')
            modality = body.get('modality', 'CUA') # Default to CUA if not specified
            tenant_id = body.get('tenant_id') or body.get('user_id')
            
            if not job_id or not tenant_id:
                print(f"Skipping invalid record: {body}")
                continue

            print(f"Processing job {job_id} for tenant {tenant_id}, modality {modality}")

            # Select task definition based on modality
            task_def = os.environ.get('CUA_TASK_DEF') if modality == 'CUA' \
                       else os.environ.get('VOICE_TASK_DEF')
            
            if not task_def:
                print(f"Error: Task definition not found for modality {modality}")
                continue

            # Update job status to DISPATCHED
            try:
                jobs_table.update_item(
                    Key={'PK': f'TENANT#{tenant_id}#JOB#{job_id}', 'SK': 'META'},
                    UpdateExpression='SET #s = :s, updated_at = :t',
                    ExpressionAttributeNames={'#s': 'status'},
                    ExpressionAttributeValues={':s': 'DISPATCHED', ':t': int(time.time())}
                )
            except Exception as ignored:
                print(f"Warning: Failed to update status in DynamoDB: {ignored}")

            # Launch ECS task
            # Using overrides to inject per-job config
            response = ecs.run_task(
                cluster=os.environ['ECS_CLUSTER'],
                taskDefinition=task_def,
                launchType='FARGATE',
                count=1,
                networkConfiguration={
                    'awsvpcConfiguration': {
                        'subnets': os.environ['COMPUTE_SUBNETS'].split(','),
                        'securityGroups': [os.environ['COMPUTE_SG']],
                        'assignPublicIp': 'DISABLED',
                    }
                },
                overrides={
                    'containerOverrides': [{
                        'name': 'agent',
                        'environment': [
                            {'name': 'JOB_ID', 'value': job_id},
                            {'name': 'TENANT_ID', 'value': tenant_id},
                            {'name': 'PATIENT_ID', 'value': body.get('patient_id', '')},
                            {'name': 'INSURANCE_NAME', 'value': body.get('insurance_name', '')},
                            {'name': 'MEMBER_ID', 'value': body.get('member_id', '')},
                            {'name': 'PORTAL_URL', 'value': body.get('portal_url', '')},
                            {'name': 'PHONE_NUMBER', 'value': body.get('phone_number', '')},
                        ],
                    }],
                },
                tags=[
                    {'key': 'tenant_id', 'value': tenant_id},
                    {'key': 'job_id', 'value': job_id},
                ],
                propagateTags='TASK_DEFINITION'
            )

            # Store ECS task ARN
            if response.get('tasks'):
                task_arn = response['tasks'][0]['taskArn']
                print(f"Launched task: {task_arn}")
                try:
                    jobs_table.update_item(
                        Key={'PK': f'TENANT#{tenant_id}#JOB#{job_id}', 'SK': 'META'},
                        UpdateExpression='SET ecs_task_arn = :a',
                        ExpressionAttributeValues={':a': task_arn}
                    )
                except Exception as ignored:
                     print(f"Warning: Failed to update task ARN in DynamoDB: {ignored}")
            elif response.get('failures'):
                print(f"Failed to launch task: {response['failures']}")
                
        except Exception as e:
            print(f"Error processing record: {e}")
            raise e # Raise to ensure SQS retry/DLQ logic works

    return {'statusCode': 200, 'body': json.dumps({'message': 'Done'})}
