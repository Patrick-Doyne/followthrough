# The training worker. The Ultralytics release pinned here is the one the
# local machine and the original runs used, so a configuration trained on AWS
# and one trained locally come from the same code.
#
#   docker build -t followthrough-train research/training/
#   docker run --gpus all --shm-size 8g --network host -e BUCKET=... \
#     -v ~/.aws:/root/.aws:ro -v /some/disk:/work followthrough-train
FROM ultralytics/ultralytics:8.4.121

# boto3 new enough for S3 conditional writes (IfNoneMatch / IfMatch), which
# the job leases depend on.
RUN pip install --no-cache-dir "boto3>=1.36"

WORKDIR /opt/training
COPY matrix.py worker.py ./

# Every machine writes into /work, so a checkpoint's recorded paths resolve
# the same wherever it is resumed.
ENV WORK=/work PYTHONUNBUFFERED=1
VOLUME /work
CMD ["python", "/opt/training/worker.py"]
